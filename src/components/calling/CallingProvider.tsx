"use client";
import * as React from "react";
import { Phone } from "lucide-react";
import type { CallingClient } from "@/lib/calling/client";
import type { DeviceClient } from "@/lib/device-client";
import { useCallingText } from "@/i18n/calling";
import { useFeatures } from "@/components/providers/features-provider";
import { FeatureOffState } from "@/components/ui/feature-gate";
const ActiveCallingProvider = React.lazy(
  () => import("./ActiveCallingProvider"),
);
export const CallingContext = React.createContext<{
  open: () => void;
  client: CallingClient;
} | null>(null);
export function CallLauncher({
  className = "btn-tinted min-h-11",
  onOpen,
}: {
  className?: string;
  onOpen?: () => void;
}) {
  const context = React.useContext(CallingContext),
    text = useCallingText();
  if (!context) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onOpen?.();
        context.open();
      }}
    >
      <Phone size={18} aria-hidden="true" />
      <span>{text("callFamily")}</span>
    </button>
  );
}
export function DashboardCallingProvider({
  available,
  identityKey,
  children,
}: {
  available: boolean;
  identityKey: string;
  children: React.ReactNode;
}) {
  const { features } = useFeatures();
  return (
    <CallingProvider
      enabled={available && features.calling}
      identityKey={identityKey}
    >
      {children}
    </CallingProvider>
  );
}
export function CallingProvider({
  enabled,
  identityKey,
  deviceClient,
  children,
}: {
  enabled: boolean;
  identityKey: string;
  deviceClient?: DeviceClient | null;
  children: React.ReactNode;
}) {
  // Keying the active host removes all media when account/device identity changes.
  if (!enabled || !identityKey) return <>{children}</>;
  return (
    <React.Suspense fallback={children}>
      <ActiveCallingProvider
        key={identityKey}
        identityKey={identityKey}
        deviceClient={deviceClient}
      >
        {children}
      </ActiveCallingProvider>
    </React.Suspense>
  );
}
export function CallsPageContent() {
  const { features, canManage } = useFeatures();
  const context = React.useContext(CallingContext),
    text = useCallingText();
  if (!features.calling)
    return (
      <FeatureOffState
        featureKey="calling"
        canManage={canManage}
        headingLevel={1}
      />
    );
  return (
    <div className="space-y-4">
      <h1 className="text-large-title font-semibold">{text("title")}</h1>
      <p className="text-label-secondary">{text("intro")}</p>
      {context ? (
        <CallLauncher className="btn-filled min-h-11" />
      ) : (
        <p role="status" className="text-label-secondary">
          {text("setup")}
        </p>
      )}
    </div>
  );
}
