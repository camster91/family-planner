/** Local workerd fixture only. No provider or production entrypoint imports this. */
import {
  nativeRegistrationSchema,
  nativeUnregisterSchema,
  sameNativeOwner,
} from "../../../src/lib/calling/native-registration-contract";
import {
  registerNativeInstallation,
  listNativeInstallations,
  inspectNativeInstallation,
  unregisterNativeInstallation,
  NativeInstallationError,
  assertNativeCommand,
} from "../../../src/lib/calling/native-installations";
import {
  nativeTokenAad,
  openNativeToken,
} from "../../../src/lib/calling/native-token";
import type { D1Store } from "../../../src/lib/cloudflare/database";
type Env = {
  DB: D1Store;
  LOCAL_NATIVE_CALL_FIXTURE?: string;
  NATIVE_CALL_TOKEN_KEY: string;
};
const fixture = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      env.LOCAL_NATIVE_CALL_FIXTURE !== "1" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      return new Response(null, { status: 404 });
    const person = url.searchParams.get("actor");
    if (person !== "a" && person !== "b")
      return new Response(null, { status: 403 });
    const owner = {
      userId: `native-fixture-user-${person}`,
      familyId: `native-fixture-family-${person}`,
      generation: 0,
    };
    const now =
      Number(request.headers.get("x-local-fixture-time")) || Date.now();
    try {
      if (url.pathname === "/list")
        return Response.json(await listNativeInstallations(env.DB, owner, now));
      if (url.pathname === "/register") {
        const body = nativeRegistrationSchema.safeParse(await request.json());
        if (!body.success) return new Response(null, { status: 400 });
        return Response.json(
          await registerNativeInstallation(
            env.DB,
            owner,
            body.data,
            env.NATIVE_CALL_TOKEN_KEY,
            now,
          ),
        );
      }
      if (url.pathname === "/unlink") {
        const body = nativeUnregisterSchema.safeParse(await request.json());
        if (!body.success) return new Response(null, { status: 400 });
        if (!sameNativeOwner(owner, body.data.owner))
          return new Response(null, { status: 409 });
        assertNativeCommand(body.data.issuedAt, now);
        const installation = await unregisterNativeInstallation(
          env.DB,
          owner,
          body.data.installationId,
          body.data.expected,
          now,
        );
        return Response.json({ removed: true, installation });
      }
      if (url.pathname === "/inspect") {
        const input = (await request.json()) as { installationId: string };
        return Response.json(
          await inspectNativeInstallation(
            env.DB,
            owner,
            input.installationId,
            now,
          ),
        );
      }
      if (url.pathname === "/verify-sealing") {
        const input = (await request.json()) as {
          installationId: string;
          token: string;
        };
        const row = await env.DB.prepare(
          'SELECT * FROM "NativeCallInstallation" WHERE id=? AND user_id=?',
        )
          .bind(input.installationId, owner.userId)
          .first<{
            push_token_enc: string;
            platform: string;
            epoch: string;
            revision: number;
          }>();
        if (!row) return new Response(null, { status: 404 });
        return Response.json({
          sealed: !row.push_token_enc.includes(input.token),
          matches:
            openNativeToken(
              row.push_token_enc,
              nativeTokenAad(input.installationId, owner, row.platform, row),
              env.NATIVE_CALL_TOKEN_KEY,
            ) === input.token,
          foreignRejected:
            openNativeToken(
              row.push_token_enc,
              nativeTokenAad(
                input.installationId,
                { ...owner, familyId: "other" },
                row.platform,
                row,
              ),
              env.NATIVE_CALL_TOKEN_KEY,
            ) === null,
          staleStampRejected:
            openNativeToken(
              row.push_token_enc,
              nativeTokenAad(input.installationId, owner, row.platform, {
                ...row,
                revision: row.revision + 1,
              }),
              env.NATIVE_CALL_TOKEN_KEY,
            ) === null,
        });
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof NativeInstallationError
              ? error.code
              : "FIXTURE_FAILURE",
        },
        {
          status: error instanceof NativeInstallationError ? error.status : 500,
        },
      );
    }
  },
};

export default fixture;
