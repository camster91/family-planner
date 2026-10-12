"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import type {
  BoardChore,
  BoardMember,
  BoardSubject,
} from "@/app/dashboard/today/today-board-data";
import type {
  BoardActions,
  ActionResult,
} from "@/components/fridge/board-actions";
import { DeviceApiError, type DeviceClient } from "@/lib/device-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { useTranslation } from "@/i18n";
import { useTodayBoardText } from "@/i18n/today-board";
import { getDeviceQueue } from "@/lib/offline-queue-browser";
import { QueueError, isCheckedOperation } from "@/lib/offline-queue";
import { MEMBER_COLOR_CSS, type MemberColorKey } from "@/lib/member-colors";
import { focusRing } from "./styles";
import { PRODUCT_BRAND } from "@/lib/brand";

/** A picked member is remembered this long after the last tap (memory only). */
export const ACTOR_IDLE_MS = 2 * 60 * 1000;

export interface DeviceActorChoice {
  id: string;
  name: string;
}

/**
 * The tablet's credential-bearing actor is separate from the subject of a
 * chore. Account subjects keep the legacy id; profile subjects are explicit
 * and can never be sent through `actingMemberId`.
 */
export type DeviceSubjectChoice =
  | { kind: "account"; id: string; name: string }
  | { kind: "profile"; memberId: string; name: string };

function subjectForMember(member: BoardMember): BoardSubject {
  if (member.subject) return member.subject;
  return { kind: "account", accountId: member.id, name: member.name };
}

function profileIdForMember(member: BoardMember): string | null {
  const subject = subjectForMember(member);
  return subject.kind === "profile" ? subject.memberId : null;
}

function profileIdForChore(chore: BoardChore | null): string | null {
  if (!chore) return null;
  if (chore.subject?.kind === "profile") return chore.subject.memberId;
  // Keep older DTOs safe during a rolling deploy. This branch is only a
  // profile subject when the server names the field explicitly; it is never
  // inferred from the legacy account assignee id.
  if (
    "assigneeProfileId" in chore &&
    typeof chore.assigneeProfileId === "string"
  )
    return chore.assigneeProfileId;
  return null;
}

function writeErrorText(error: unknown): string {
  if (error instanceof DeviceApiError) {
    if (error.code === "NETWORK_ERROR")
      return `Couldn't reach ${PRODUCT_BRAND.name}. Check the Wi-Fi and try again.`;
    if (error.status === 429)
      return "Too many taps. Wait a minute, then try again.";
    if (error.status > 0 && error.status < 500 && error.message)
      return error.message;
  }
  return "Something went wrong. Try again.";
}

/**
 * Tile actions for a paired tablet (#274, SHARED_DEVICE.md §9.2):
 *
 * - before the first tap it asks "Who's this?" (names and colours from the
 *   board, §9.1) and remembers the answer in memory for two minutes after the
 *   last tap; the choice is unverified attribution (O-5) and never grants
 *   anything;
 * - a chore tap posts POST /api/device/chores/:id/complete with a fresh
 *   Idempotency-Key; Undo posts the tablet's own short-window
 *   POST /api/device/chores/:id/uncomplete;
 * - a grocery tap queues the explicit state in the device's #162 queue
 *   (PATCH /api/device/lists/items/:id), so it survives a dropped Wi-Fi.
 *
 * Returns no actions (a read-only board) unless the household turned tablet
 * writes on.
 */
export function useDeviceBoardActions({
  client,
  enabled,
  features,
  members,
  memberProtocol = 1,
  afterChange,
}: {
  client: DeviceClient | null;
  enabled: boolean;
  features: { chores: boolean; lists: boolean } | null;
  members: BoardMember[];
  /** Profile subjects are only actionable after the server explicitly opts this tablet into protocol 2. */
  memberProtocol?: 1 | 2;
  afterChange: () => void;
}): {
  actions: BoardActions | undefined;
  actor: DeviceActorChoice | null;
  subject: DeviceSubjectChoice | null;
  forgetActor: () => void;
  picker: React.ReactNode;
} {
  const { t } = useTranslation();
  const [subject, setSubject] = React.useState<DeviceSubjectChoice | null>(
    null,
  );
  const subjectRef = React.useRef<DeviceSubjectChoice | null>(null);
  const lastTapRef = React.useRef(0);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerMode, setPickerMode] = React.useState<"account" | "profile">(
    "account",
  );
  const [requiredProfileId, setRequiredProfileId] = React.useState<
    string | null
  >(null);
  const resolver = React.useRef<((ok: boolean) => void) | null>(null);
  const afterRef = React.useRef(afterChange);
  afterRef.current = afterChange;

  const chooseSubject = React.useCallback(
    (next: DeviceSubjectChoice | null) => {
      subjectRef.current = next;
      setSubject(next);
    },
    [],
  );

  // Forget the member after two idle minutes, so the next person is asked again.
  React.useEffect(() => {
    if (!subject) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastTapRef.current >= ACTOR_IDLE_MS) chooseSubject(null);
    }, 5000);
    return () => window.clearInterval(id);
  }, [subject, chooseSubject]);

  const settle = React.useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPickerOpen(false);
    resolve?.(ok);
  }, []);

  const choresOn = Boolean(enabled && features?.chores);
  const listsOn = Boolean(enabled && features?.lists);

  const actions = React.useMemo<BoardActions | undefined>(() => {
    if (!client || (!choresOn && !listsOn)) return undefined;
    const mine = new Set<string>();
    const membersByProfileId = new Map(
      members
        .map((member) => {
          const profileId = profileIdForMember(member);
          return profileId ? ([profileId, member] as const) : null;
        })
        .filter(
          (entry): entry is readonly [string, BoardMember] => entry !== null,
        ),
    );
    const accountMembers = members.filter(
      (member) => !profileIdForMember(member),
    );

    const accountId = () =>
      subjectRef.current?.kind === "account" ? subjectRef.current.id : "";
    const subjectForChore = (chore: BoardChore): DeviceSubjectChoice | null => {
      const profileId = profileIdForChore(chore);
      if (profileId) {
        const profile = membersByProfileId.get(profileId);
        return profile
          ? { kind: "profile", memberId: profileId, name: profile.name }
          : null;
      }
      const selected = subjectRef.current;
      return selected?.kind === "account" ? selected : null;
    };

    const post = async (
      path: string,
      chore: BoardChore,
    ): Promise<ActionResult> => {
      const selected = subjectForChore(chore);
      if (!selected) {
        return {
          ok: false,
          message: "Choose the assigned family member, then try again.",
        };
      }
      try {
        await client.request(path, {
          method: "POST",
          body:
            selected.kind === "profile"
              ? { protocol: 2, selection: { memberId: selected.memberId } }
              : { actingMemberId: selected.id },
          headers: { "Idempotency-Key": newIdempotencyKey() },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: writeErrorText(error) };
      }
    };

    const prepareSubject = (targetProfileId: string | null) => {
      const selected = subjectRef.current;
      const selectionMatches = targetProfileId
        ? memberProtocol === 2 &&
          selected?.kind === "profile" &&
          selected.memberId === targetProfileId
        : selected?.kind === "account";
      if (
        selectionMatches &&
        Date.now() - lastTapRef.current < ACTOR_IDLE_MS
      ) {
        lastTapRef.current = Date.now();
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = (ok) => {
          if (ok) lastTapRef.current = Date.now();
          resolve(ok);
        };
        setPickerMode(targetProfileId ? "profile" : "account");
        setRequiredProfileId(targetProfileId);
        setPickerOpen(true);
      });
    };

    return {
      canTickGroceries: listsOn,
      // Grocery capture and ticks always need an account subject. Keep this
      // independent from chore rendering, which may inspect profile chores.
      prepare: () => prepareSubject(null),
      prepareChore: (chore) => prepareSubject(profileIdForChore(chore)),
      canCompleteChore: (chore) => {
        const profileId = profileIdForChore(chore);
        if (profileId)
          return (
            choresOn &&
            memberProtocol === 2 &&
            membersByProfileId.has(profileId)
          );
        return choresOn && accountMembers.length > 0;
      },
      completeChore: (chore) => {
        return post(
          `/api/device/chores/${encodeURIComponent(chore.id)}/complete`,
          chore,
        );
      },
      undoChore: (chore) => {
        return post(
          `/api/device/chores/${encodeURIComponent(chore.id)}/uncomplete`,
          chore,
        );
      },
      choreDoneNote: () => "A parent will check it.",
      actorLabel: () =>
        subjectRef.current?.kind === "account"
          ? subjectRef.current.name.trim().split(/\s+/)[0]
          : null,
      async setGroceryChecked(item, checked) {
        const selected = subjectRef.current;
        if (selected?.kind !== "account") {
          return {
            ok: false,
            message: "Choose a family account before updating groceries.",
          };
        }
        try {
          const op = await getDeviceQueue(client).enqueue(
            "device.list-item.set-checked",
            {
              itemId: item.id,
              checked,
              actingMemberId: accountId(),
            },
          );
          mine.add(op.id);
          return { ok: true };
        } catch (error) {
          if (
            error instanceof QueueError &&
            error.code === "COMPATIBLE_CLIENT_REQUIRED"
          )
            return { ok: false, message: t("groceries.compatibleClient") };
          if (error instanceof QueueError && error.code === "QUEUE_FULL") {
            return {
              ok: false,
              message:
                "Too many changes are waiting for the Wi-Fi. Try again when it is back.",
            };
          }
          return { ok: false, message: "Something went wrong. Try again." };
        }
      },
      onGroceryFailed(listener) {
        const q = getDeviceQueue(client);
        return q.subscribe((event) => {
          if (event.type !== "change") return;
          for (const op of q.list()) {
            if (!isCheckedOperation(op) || !mine.has(op.id)) continue;
            if (op.state === "failed" || op.state === "conflict") {
              mine.delete(op.id);
              void q.discard(op.id);
              listener(op.payload.itemId, op.payload.checked);
            }
          }
        });
      },
      afterChange: () => afterRef.current(),
    };
  }, [client, choresOn, listsOn, t, members, memberProtocol]);

  const picker = (
    <WhoIsThisDialog
      open={pickerOpen}
      members={members}
      mode={pickerMode}
      requiredProfileId={requiredProfileId}
      onPick={(m) => {
        chooseSubject(m);
        settle(true);
      }}
      onClose={() => settle(false)}
    />
  );

  const actor = subject?.kind === "account" ? subject : null;
  return {
    actions,
    actor,
    subject,
    forgetActor: () => chooseSubject(null),
    picker,
  };
}

/** "Who's this?" (O-5): names and board colours only (§9.1). */
function WhoIsThisDialog({
  open,
  members,
  mode,
  requiredProfileId,
  onPick,
  onClose,
}: {
  open: boolean;
  members: BoardMember[];
  mode: "account" | "profile";
  requiredProfileId: string | null;
  onPick: (member: DeviceSubjectChoice) => void;
  onClose: () => void;
}) {
  const text = useTodayBoardText();
  const choices = members.filter((member) => {
    const profileId = profileIdForMember(member);
    return mode === "profile"
      ? profileId === requiredProfileId
      : profileId === null;
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "profile" ? text("profilePickerTitle") : "Who's this?"}
      testId="who-is-this"
      description={
        mode === "profile"
          ? text("profilePickerDescription")
          : "Pick your name so the family knows who made the change."
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Family members">
        {choices.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                const profileId = profileIdForMember(m);
                onPick(
                  profileId
                    ? { kind: "profile", memberId: profileId, name: m.name }
                    : { kind: "account", id: m.id, name: m.name },
                );
              }}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 text-left text-[19px] font-semibold text-label-primary active:bg-[var(--surface-fill)] ${focusRing}`}
            >
              <span
                aria-hidden="true"
                className="h-5 w-5 shrink-0 rounded-full"
                style={{
                  backgroundColor: m.color
                    ? MEMBER_COLOR_CSS[m.color as MemberColorKey]
                    : "var(--surface-fill)",
                }}
              />
              <span className="min-w-0 break-words">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
