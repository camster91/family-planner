"use client";
import * as React from "react";
import {
  readResponsibility,
  readResponsibilityContext,
} from "@/lib/responsibility-client";
import type { ResponsibilityTarget } from "@/lib/responsibility";
import type { ResponsibilityView } from "@/lib/responsibility-http-contract";
import { useResponsibilityText } from "@/i18n/responsibility";
/** Bounded weekly-review projection. Separate transactions preserve the runtime
 * identity-before-target lock order. Never authority to send a statement. */
export default function ResponsibilityPreview({
  target,
}: {
  target: ResponsibilityTarget;
}) {
  const copy = useResponsibilityText();
  const [view, setView] = React.useState<ResponsibilityView | null>(null),
    [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const context = await readResponsibilityContext();
        if (!live) return;
        const result = await readResponsibility(target, context);
        if (live) setView(result);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [target.kind, target.id]);
  if (failed)
    return (
      <p className="text-footnote text-label-secondary">
        {copy.previewUnavailable}
      </p>
    );
  if (!view)
    return (
      <p role="status" className="text-footnote text-label-secondary">
        {copy.loading}
      </p>
    );
  return (
    <div className="text-footnote text-label-secondary">
      <p>{copy.snapshot}</p>
      {!view.active && <p>{copy.closed}</p>}
      {view.sourceChanged && <p>{copy.changed}</p>}
      {(["primary", "backup"] as const).map((key) => {
        const value = view[key];
        return (
          <p key={key} className="break-words">
            {key === "backup"
              ? copy.backup
              : target.kind === "handoff"
                ? copy.coordinator
                : copy.primary}
            :{" "}
            {value
              ? `${value.member.name} · ${value.statement ? copy[value.statement.decision] : copy.awaiting}${value.statement ? ` · ${value.statement.method === "self" ? copy.self : copy.recorded}` : ""}`
              : copy.none}
          </p>
        );
      })}
    </div>
  );
}
