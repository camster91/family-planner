"use client";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
export function RoutineScheduleHandoff({
  href,
  sheet = false,
}: {
  href: string;
  sheet?: boolean;
}) {
  const t = useRoutineScheduleText(),
    router = useRouter();
  // Full navigation deliberately leaves the older intercepted form slot. No
  // legacy draft was loaded and no schedule/step is changed by this handoff.
  const content = (
    <div className="space-y-4">
      <p className="text-body text-label-secondary">
        {t(
          href.includes("/schedules/independent")
            ? "independentHandoff"
            : "handoff",
        )}
      </p>
      <a
        href={href}
        className="btn-filled inline-flex min-h-[44px] items-center"
      >
        {t("open")}
      </a>
    </div>
  );
  return sheet ? (
    <Dialog
      open
      title={t("title")}
      variant="form"
      closeLabel={t("close")}
      onClose={() => router.back()}
    >
      {content}
    </Dialog>
  ) : (
    <section className="space-y-4">
      <h1 className="text-title-1 text-label-primary">{t("title")}</h1>
      {content}
    </section>
  );
}
