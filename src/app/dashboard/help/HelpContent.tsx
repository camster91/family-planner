"use client";

import AppDiagnostics from "./AppDiagnostics";
import SyncDiagnostics from "./SyncDiagnostics";
import * as React from "react";
import Link from "next/link";
import { LargeHeader } from "@/components/ui/large-header";
import { supportEmail } from "@/lib/support";
import { canRoleAccessPath } from "@/lib/kid-access";
import { useHelpText } from "@/i18n/help";
import { APP_HELP_TOPICS } from "@/lib/app-help-topics";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { useFeatures } from "@/components/providers/features-provider";

function PageLink({
  href,
  role,
  children,
}: {
  href: string;
  role?: string | null;
  children: React.ReactNode;
}) {
  const { features } = useFeatures();
  const topic = APP_HELP_TOPICS.find((candidate) => candidate.href === href);
  if (
    (topic?.feature && !isFeatureEnabled(features, topic.feature)) ||
    (href.startsWith("/dashboard") &&
      !canRoleAccessPath(role, href.split(/[?#]/)[0]))
  )
    return <span className="font-medium text-label-primary">{children}</span>;
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center rounded-lg text-subhead font-semibold text-[var(--accent-text)] underline underline-offset-2"
    >
      {children}
    </Link>
  );
}
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== `#${id}` || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [id]);
  return (
    <details
      ref={ref}
      id={id}
      className="card-apple scroll-mt-24 p-5"
      open={id === "help-start"}
    >
      <summary className="min-h-[44px] cursor-pointer content-center rounded-lg focus-visible:outline">
        <h2 className="inline text-title-3 text-label-primary">{title}</h2>
      </summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}
function Item({
  title,
  children,
  link,
}: {
  title: string;
  children: React.ReactNode;
  link?: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-body font-semibold text-label-primary">{title}</h3>
      <p className="mt-1 text-subhead leading-relaxed text-label-secondary">
        {children}
      </p>
      {link}
    </div>
  );
}

export default function HelpContent({
  supportEmail: configured,
  role,
  userId,
}: {
  userId?: string;
  supportEmail?: string;
  role?: string | null;
}) {
  const email = supportEmail(configured);
  const text = useHelpText();
  const link = (href: string, label: string) => (
    <PageLink href={href} role={role}>
      {label}
    </PageLink>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-3 pb-20">
      <LargeHeader title={text("title")} subtitle={text("intro")} />
      <Section id="help-start" title={text("start")}>
        <Item
          title={text("create")}
          link={link("/dashboard/family/create", text("create"))}
        >
          {text("createHelp")}
        </Item>
        <Item
          title={text("invite")}
          link={link("/dashboard/family/invite", text("invite"))}
        >
          {text("inviteHelp")}
        </Item>
        <Item title={text("join")} link={link("/join", text("join"))}>
          {text("joinHelp")}
        </Item>
      </Section>
      <Section id="help-chores" title={text("chores")}>
        <Item
          title={text("chores")}
          link={link("/dashboard/chores", text("chores"))}
        >
          {text("choresHelp")}
        </Item>
        <Item
          title={text("routines")}
          link={link("/dashboard/chores/routines", text("routines"))}
        >
          {text("routinesHelp")}
        </Item>
        <Item
          title={text("rewards")}
          link={link("/dashboard/rewards", text("rewards"))}
        >
          {text("rewardsHelp")}
        </Item>
      </Section>
      <Section id="help-plan" title={text("plan")}>
        <Item
          title={text("calendar")}
          link={link("/dashboard/calendar", text("calendar"))}
        >
          {text("calendarHelp")}
        </Item>
        <Item
          title={text("meals")}
          link={link("/dashboard/meals", text("meals"))}
        >
          {text("mealsHelp")}
        </Item>
        <Item
          title={text("prep")}
          link={link("/dashboard/meals?view=bulk", text("prep"))}
        >
          {text("prepHelp")}
        </Item>
        <Item
          title={text("recipes")}
          link={link("/dashboard/meals/explore", text("recipes"))}
        >
          {text("recipesHelp")}
        </Item>
        <Item
          title={text("inventory")}
          link={link("/dashboard/inventory", text("inventory"))}
        >
          {text("inventoryHelp")}
        </Item>
        <Item
          title={text("lists")}
          link={link("/dashboard/lists", text("lists"))}
        >
          {text("listsHelp")}
        </Item>
      </Section>
      <Section id="help-account" title={text("account")}>
        <Item
          title={text("password")}
          link={link("/forgot-password", text("password"))}
        >
          {text("passwordHelp")}
        </Item>
        <Item title={text("verification")}>{text("verificationHelp")}</Item>
      </Section>
      <Section id="help-data" title={text("data")}>
        <Item
          title={text("export")}
          link={link("/dashboard/settings#settings-privacy", text("export"))}
        >
          {text("exportHelp")}
        </Item>
        <Item
          title={text("deletion")}
          link={link("/dashboard/settings#settings-privacy", text("deletion"))}
        >
          {text("deletionHelp")}
        </Item>
        <Item title={text("privacy")} link={link("/privacy", text("privacy"))}>
          {text("privacyHelp")}
        </Item>
      </Section>
      {userId && (role === "parent" || role === "teen") && (
        <Section id="help-diagnostics" title={text("diagnostics")}>
          <SyncDiagnostics userId={userId} />
          <AppDiagnostics />
        </Section>
      )}
      <Section id="help-contact" title={text("contact")}>
        <p className="text-subhead text-label-secondary">
          {text("supportHelp")}
        </p>
        {email ? (
          <a
            href={`mailto:${email}`}
            className="inline-flex min-h-[44px] items-center text-[var(--accent-text)] underline [overflow-wrap:anywhere]"
            data-testid="support-email"
          >
            {email}
          </a>
        ) : (
          <>
            <p
              className="font-medium text-label-primary"
              data-testid="support-email"
            >
              {text("supportPending")}
            </p>
            <p className="text-subhead text-label-secondary">
              {text("supportFallback")}
            </p>
          </>
        )}
        <p className="text-subhead text-label-secondary">
          {text("privacyIncident")}
        </p>
      </Section>
    </div>
  );
}
