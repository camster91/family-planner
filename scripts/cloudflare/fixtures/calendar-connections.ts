import type { D1Store } from "../../../src/lib/cloudflare/database";
import { buildD1CalendarFeed } from "../../../src/lib/cloudflare/calendar-feed";
import {
  commitD1CalendarConnection,
  readD1CalendarConnections,
  readD1CalendarConnectionSecret,
  clearD1CalendarConnection,
} from "../../../src/lib/cloudflare/calendar-connections";
import {
  consumeD1OAuthState,
  createD1OAuthState,
} from "../../../src/lib/cloudflare/calendar-oauth-state";
import { syncD1CalendarConnection } from "../../../src/lib/cloudflare/calendar-two-way-sync";
import {
  encryptToken,
  tokenAad,
} from "../../../src/lib/calendar-sync/token-crypto";
import { fieldsHash } from "../../../src/lib/calendar-sync/mapping";
import type {
  CalendarProviderAdapter,
  OAuthClient,
  PullResult,
} from "../../../src/lib/calendar-sync/types";
import { ProviderHttpError } from "../../../src/lib/calendar-sync/http";
import type { ProviderConfig } from "../../../src/lib/calendar-sync/config";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function testCalendarConnections(db: D1Store) {
  process.env.CALENDAR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.JWT_SECRET = "fabricated-calendar-connections-fixture-key";
  await db
    .prepare(
      `INSERT INTO "Family" (id,name,invite_code,feed_token) VALUES ('conn-family','Fixture household','conn-code','feed-fixture'),('conn-foreign','Other household','other-code','feed-other')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('conn-parent','conn-parent@example.test','Fixture parent','conn-family','parent'),
    ('conn-teen','conn-teen@example.test','Fixture teen','conn-family','teen'),
    ('conn-other','conn-other@example.test','Other parent','conn-foreign','parent')`,
    )
    .run();
  const actor = {
    userId: "conn-parent",
    familyId: "conn-family",
    role: "parent",
    generation: 0,
  } as const;
  const teen = { ...actor, userId: "conn-teen", role: "teen" } as const;
  const foreign = {
    ...actor,
    userId: "conn-other",
    familyId: "conn-foreign",
  } as const;

  const started = await createD1OAuthState(
    actor,
    "google",
    new Date("2026-10-28T12:00:00Z"),
    db,
  );
  check(started?.state && started.codeChallenge, "native OAuth state created");
  check(
    (
      await consumeD1OAuthState(
        actor,
        {
          state: started.state,
          provider: "microsoft",
          now: new Date("2026-10-28T12:01:00Z"),
        },
        db,
      )
    ).ok === false,
    "wrong provider refused",
  );
  const successState = await createD1OAuthState(actor, "google", undefined, db);
  check(successState?.state, "second native OAuth state created");
  const consumed = await consumeD1OAuthState(
    actor,
    {
      state: successState.state,
      provider: "google",
      now: new Date("2026-10-28T12:01:00Z"),
    },
    db,
  );
  check(
    consumed.ok && consumed.codeVerifier.length > 20,
    "native OAuth state consumed with PKCE verifier",
  );
  const replayed = await consumeD1OAuthState(
    actor,
    { state: successState.state, provider: "google" },
    db,
  );
  check(
    !replayed.ok && replayed.reason === "replayed",
    "OAuth state is single use",
  );
  check(
    (await createD1OAuthState(teen, "google", undefined, db)) === null,
    "teen cannot create OAuth state",
  );

  const access = encryptToken(
    "fixture-access",
    tokenAad.access(actor.familyId),
  );
  const refresh = encryptToken(
    "fixture-refresh",
    tokenAad.refresh(actor.familyId),
  );
  check(
    (await commitD1CalendarConnection(
      actor,
      "google",
      {
        access_token_enc: access,
        refresh_token_enc: refresh,
        token_expires_at: new Date(Date.now() + 3600000),
      },
      db,
    )) === "created",
    "native connection created",
  );
  const listed = await readD1CalendarConnections(actor, db);
  check(
    listed?.length === 1 &&
      listed[0].is_mine &&
      !JSON.stringify(listed).includes("fixture-access") &&
      !JSON.stringify(listed).includes("ct1."),
    "connection projection hides secrets",
  );
  const reconnected = await commitD1CalendarConnection(
    actor,
    "google",
    {
      access_token_enc: encryptToken(
        "fixture-access-reconnected",
        tokenAad.access(actor.familyId),
      ),
      // Providers may omit a refresh token on reconnect; retain the existing
      // encrypted refresh grant rather than overwriting it with NULL.
      refresh_token_enc: undefined,
      token_expires_at: new Date(Date.now() + 3600000),
    },
    db,
  );
  check(reconnected === "updated", "native reconnect updates tokens");
  const retained = await readD1CalendarConnectionSecret(actor, listed![0].id, db);
  check(
    retained?.refresh_token_enc === refresh,
    "native reconnect retains an omitted refresh token",
  );
  check(
    (await readD1CalendarConnections(foreign, db))?.length === 0,
    "foreign connection hidden",
  );

  const remote: PullResult = {
    full: true,
    nextCursor: "fixture-cursor",
    events: [
      {
        id: "remote-event",
        deleted: false,
        title: "Swimming",
        description: null,
        location: "Pool",
        start: new Date("2026-10-29T16:00:00Z"),
        end: new Date("2026-10-29T17:00:00Z"),
        allDay: false,
        etag: "etag-1",
        updated: new Date("2026-10-28T11:00:00Z"),
        marker: null,
      },
    ],
  };
  let rejectFirstPull = true;
  let refreshCalls = 0;
  const provider: CalendarProviderAdapter = {
    provider: "google",
    async listCalendars() {
      return [{ id: "primary", name: "Home", primary: true, canWrite: true }];
    },
    async pull() {
      if (rejectFirstPull) {
        rejectFirstPull = false;
        throw new ProviderHttpError("unauthorized", 401);
      }
      return remote;
    },
    async create(_token, _calendar, input) {
      return {
        id: `created-${input.marker.eventId}`,
        etag: "created-etag",
        updated: new Date(),
      };
    },
    async update() {
      return { id: "remote-event", etag: "etag-2", updated: new Date() };
    },
    async remove() {},
  };
  const oauth: OAuthClient = {
    provider: "google",
    scopes: [],
    authorizeUrl() {
      return "https://example.test";
    },
    async exchangeCode() {
      throw new Error("not used");
    },
    async refresh() {
      refreshCalls += 1;
      return {
        accessToken: "refreshed",
        refreshToken: "fixture-refresh",
        expiresAt: new Date(Date.now() + 3600000),
        scope: null,
      };
    },
    hasRequiredScopes() {
      return true;
    },
    async revoke() {},
  };
  const config: ProviderConfig = {
    provider: "google",
    clientId: "fixture",
    clientSecret: "fixture",
    redirectUri: "https://family.example.test/callback",
  };
  const nativeDeps = {
    database: db,
    now: new Date("2026-10-28T12:00:00Z"),
    adapterFor: () => provider,
    oauthFor: () => oauth,
    configFor: () => config,
  };
  await db
    .prepare(
      `UPDATE "CalendarConnection" SET calendar_id='primary' WHERE id=(SELECT id FROM "CalendarConnection" WHERE family_id='conn-family')`,
    )
    .run();
  const first = await syncD1CalendarConnection(
    actor,
    listed![0].id,
    nativeDeps,
  );
  check(
    first?.status === "ok" &&
      first.pulled.created === 1 &&
      first.pushed.created === 0 &&
      refreshCalls === 1,
    "native provider pull imports event",
  );
  const imported = await db
    .prepare(
      `SELECT id,title,source_connection_id FROM "Event" WHERE family_id='conn-family' AND source_connection_id IS NOT NULL`,
    )
    .first<{ id: string; title: string; source_connection_id: string }>();
  check(imported?.title === "Swimming", "remote event is household scoped");
  const firstLink = await db
    .prepare(`SELECT synced_hash FROM "CalendarEventLink" WHERE event_id=?1`)
    .bind(imported?.id)
    .first<{ synced_hash: string }>();
  check(
    firstLink?.synced_hash ===
      fieldsHash({
        title: "Swimming",
        description: null,
        location: "Pool",
        start_time: new Date("2026-10-29T16:00:00Z"),
        end_time: new Date("2026-10-29T17:00:00Z"),
      }),
    "link stores canonical field hash",
  );
  await db
    .prepare(
      `INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by) VALUES ('local-push','conn-family','Family dinner',?1,?2,'conn-parent')`,
    )
    .bind(
      new Date("2026-10-29T18:00:00Z").getTime(),
      new Date("2026-10-29T19:00:00Z").getTime(),
    )
    .run();
  await db
    .prepare(
      `UPDATE "CalendarConnection" SET push_mode='all' WHERE family_id='conn-family'`,
    )
    .run();
  const pushed = await syncD1CalendarConnection(actor, listed![0].id, {
    ...nativeDeps,
    now: new Date("2026-10-28T12:01:00Z"),
  });
  check(pushed?.pushed.created === 1, "push-all creates local event remotely");

  const feed = await buildD1CalendarFeed(
    "feed-fixture",
    new Date("2026-10-28T12:00:00Z"),
    db,
  );
  check(
    feed.kind === "ok" &&
      feed.ics.includes("Swimming") &&
      feed.ics.includes("Family dinner"),
    "native ICS feed uses current D1 events",
  );
  check(
    (await buildD1CalendarFeed("missing", new Date(), db)).kind ===
      "unauthorized",
    "unknown feed token refused",
  );
  const secret = await readD1CalendarConnectionSecret(actor, listed![0].id, db);
  check(
    secret?.refresh_token_enc &&
      (await clearD1CalendarConnection(actor, listed![0].id, db)) === 1,
    "connection cleanup removes imported events only",
  );
  check(
    (await db
      .prepare(`SELECT id FROM "Event" WHERE id='local-push'`)
      .first()) !== null,
    "local pushed event survives disconnect",
  );
  return {
    oauthPkce: true,
    singleUse: true,
    connectionPrivacy: true,
    reconnectRefreshRetention: true,
    providerPull: true,
    providerPush: true,
    feed: true,
    disconnectIsolation: true,
  };
}
