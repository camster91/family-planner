"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import SettingsDisclosure from "./SettingsDisclosure";
import SettingsIcon from "./SettingsIcon";
import { useSmartHelpersSettingsText } from "@/i18n/smart-add";
import { microusdToUsd } from "@/lib/ai-usage-contract";

type View = {
  deploymentReady: boolean;
  enabled: boolean;
  revision: number;
  monthlyCapMicrousd: string;
  spentThisMonthMicrousd: string;
};

function dollars(micro: string) {
  const usd = Number(microusdToUsd(micro) || "0");
  return `$${usd.toFixed(2)}`;
}

/**
 * Parent-only "Smart helpers (AI)" switch (#144). Off by default. Hidden when
 * this deployment has no smart helpers at all, so families never see a switch
 * that cannot work. Kids never use them; the shared tablet never shows them.
 */
export default function SmartHelpersSettings() {
  const text = useSmartHelpersSettingsText();
  const [view, setView] = React.useState<View | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/family/smart-helpers", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) =>
        setView(body && typeof body.enabled === "boolean" ? body : null),
      )
      .catch(() => setView(null));
    return () => controller.abort();
  }, []);

  if (!view || (!view.deploymentReady && !view.enabled)) return null;

  async function toggle() {
    if (!view || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/family/smart-helpers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          enabled: !view.enabled,
          expectedRevision: view.revision,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body.enabled !== "boolean") {
        setError(
          typeof body?.error === "string" ? body.error : text("saveFailed"),
        );
        return;
      }
      setView(body);
    } catch {
      setError(text("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDisclosure
      id="smart-helpers"
      title={text("title")}
      description={text("description")}
      icon={<SettingsIcon icon={Sparkles} tone="violet" />}
      forceOpen={Boolean(error)}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" id="smart-helpers-explain">
          {text("explain")}
        </p>
        <p className="text-sm text-muted-foreground">
          {text("cap", {
            cap: dollars(view.monthlyCapMicrousd),
            used: dollars(view.spentThisMonthMicrousd),
          })}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={view.enabled}
          aria-describedby="smart-helpers-explain"
          disabled={saving}
          onClick={toggle}
          className="inline-flex min-h-[44px] items-center gap-3 rounded-full border border-[var(--surface-separator)] px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50"
          data-testid="smart-helpers-switch"
        >
          <span>{text("toggle")}</span>
          <span aria-hidden="true">
            {view.enabled ? text("on") : text("off")}
          </span>
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </SettingsDisclosure>
  );
}
