"use client";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { isClockFormat } from "@/lib/clock-format";
import { PRODUCT_BRAND } from "@/lib/brand";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LazyDeleteAccountDialog from "@/components/account/LazyDeleteAccountDialog";
import { Dialog } from "@/components/ui/dialog";
import { downloadMyData } from "@/lib/data-export-client";
import {
  DEFAULT_THEME,
  applyThemePreference,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from "@/lib/theme";
import { isLocale, useTranslation } from "@/i18n";
import { useSettingsCopy, SettingsText } from "./settings-copy";
import {
  settingsFeedback,
  settingsError,
  settingsResponseError,
  SettingsFeedbackError,
  type SettingsFeedback,
} from "@/i18n/settings";
import { QuietDisplayControl } from "@/components/account/QuietDisplayControl";
import NotificationPreferences from "@/components/account/NotificationPreferences";
import SettingsDisclosure from "./SettingsDisclosure";
import SettingsIcon from "./SettingsIcon";
import {
  Save,
  Bell,
  User,
  Moon,
  Globe,
  KeyRound,
  Sliders,
  Database,
  CalendarDays,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  History,
  Home,
  Users,
  UserPlus,
  TabletSmartphone,
  Download,
  Trash2,
  type LucideIcon,
} from "lucide-react";


// Settings is the default landing tab, so keep family-only controls out of
// its startup graph. Each child retains its existing disclosure, state and
// API behaviour once the family group is opened.
const LazyCalendarSubscriptionsSection = lazy(
  () => import("./CalendarSubscriptionsSection"),
);
const LazyCalendarFeedReview = lazy(() => import("./CalendarFeedReview"));
const LazyCalendarSyncSection = lazy(() => import("./CalendarSyncSection"));
const LazySharedDeviceSettings = lazy(() => import("./SharedDeviceSettings"));
const LazyAiUsagePanel = lazy(() =>
  import("@/components/assistant/AiUsagePanel").then(({ AiUsagePanel }) => ({
    default: AiUsagePanel,
  })),
);
const LazyBetaMetricsSwitch = lazy(
  () => import("@/components/account/BetaMetricsSwitch"),
);

// These controls live in lazy family/privacy children, so they are not in the
// first DOM pass for a hash deep link. Keep the canonical anchors navigable
// before those children resolve.
const FAMILY_ANCHORS = new Set([
  "calendar-subscriptions",
  "calendar-subscriptions-heading",
  "calendar-sync",
  "calendar-sync-heading",
  "tablet-pin",
]);
const PRIVACY_ANCHORS = new Set(["beta-metrics-switch"]);

type UserProfilePayload = {
  name: string;
  email: string | null;
  role: string;
  age: number | null;
};

function readUserProfilePayload(value: unknown): UserProfilePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;

  const profile = user as Record<string, unknown>;
  if (
    typeof profile.name !== "string" ||
    (profile.email !== null && typeof profile.email !== "string") ||
    typeof profile.role !== "string" ||
    (profile.age !== null && typeof profile.age !== "number")
  )
    return null;

  return {
    name: profile.name,
    email: profile.email,
    role: profile.role,
    age: profile.age,
  };
}

/** Who is looking at Settings; decided on the server from the database role. */
export type SettingsViewerRole = "parent" | "teen";

const rowClass =
  "flex min-h-[44px] w-full items-center gap-3 rounded-lg p-3 text-left text-foreground hover:bg-muted";

/** One of the three Settings groups: Your account, Family, Privacy & data. */
function SettingsGroup({
  id,
  title,
  children,
  active,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <section
      hidden={!active}
      data-settings-group={id}
      aria-labelledby={id}
      className="space-y-4"
    >
      <h2 id={id} className="px-1 text-xl font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function CardHeader({
  icon,
  tone,
  title,
  description,
}: {
  icon: LucideIcon;
  tone: React.ComponentProps<typeof SettingsIcon>["tone"];
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <SettingsIcon icon={icon} tone={tone} />
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Settings, in three groups (one primary action per card):
 * 1. Your account: profile, password, language, theme, notifications.
 * 2. Family (parents only): household links, family tablet, calendar feed,
 *    subscriptions and sync, AI capture. Long, rarely used parts start closed.
 * 3. Privacy & data: data export, beta usage counts (parents), delete account.
 *
 * `viewerRole` is decided on the server (./page.tsx). A teen (O-37) gets only
 * their personal sections: profile, notifications and quiet hours, theme,
 * language, password, their own data export and account deletion. Every
 * family-level section (AI capture, calendar feed, subscriptions and sync,
 * Features, imports, Recent changes, tablets and the Tablet PIN, beta usage
 * counts) is parent-only: it is not rendered and its data is never fetched.
 *
 * `aiCaptureSettings` (server-decided) shows the AI capture key form: off
 * unless CAPTURE_AI_SETTINGS_ENABLED is on or the household already saved a
 * key. While it is off the form is not rendered and its API is not called.
 *
 * `sharedDevice` is null unless the shared-device kill switch is on AND the
 * viewer is a parent. `betaMetrics` (#287) is the household's beta usage
 * counts switch, read on the server for a parent only (null otherwise, and the
 * switch is not shown).
 */
export default function SettingsClient({
  viewerRole,
  sharedDevice,
  betaMetrics = null,
  calendarSync = false,
  aiCaptureSettings = false,
  aiUsage,
  calendarFeedReviewScope,
}: {
  viewerRole: SettingsViewerRole;
  sharedDevice: { hasPin: boolean } | null;
  betaMetrics?: { enabled: boolean } | null;
  calendarSync?: boolean;
  aiCaptureSettings?: boolean;
  aiUsage?: { userId: string; familyId: string };
  calendarFeedReviewScope?: string;
}) {
  const copy = useSettingsCopy();
  const isParent = viewerRole === "parent";
  const [loading, setLoading] = useState(true);
  const [profileLoadState, setProfileLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [profileLoadError, setProfileLoadError] =
    useState<SettingsFeedback | null>(null);
  const [activeSection, setActiveSection] = useState("settings-account");
  // A provider-return callback may arrive after the lazy calendar section has
  // mounted. Once the person explicitly chooses a tab, that late callback
  // must not take them back to Family.
  const hasExplicitSectionChoice = useRef(false);
  const [hasCalendarReturn, setHasCalendarReturn] = useState(false);
  const [familyContentMounted, setFamilyContentMounted] = useState(false);
  const [privacyContentMounted, setPrivacyContentMounted] = useState(false);
  const familySectionActive = activeSection === "settings-family";
  const familyContentReady = familyContentMounted || familySectionActive;
  const privacyContentReady =
    privacyContentMounted || activeSection === "settings-privacy";
  const revealCalendarReturn = useCallback(() => {
    if (isParent && !hasExplicitSectionChoice.current)
      setActiveSection("settings-family");
  }, [isParent]);
  useEffect(() => {
    const selectAnchor = () => {
      const params = new URLSearchParams(window.location.search);
      setHasCalendarReturn(
        isParent && calendarSync && params.has("calendar_sync"),
      );
      const anchor = window.location.hash.slice(1);
      const target = document.getElementById(anchor);
      const group =
        target?.closest<HTMLElement>("[data-settings-group]")?.dataset
          .settingsGroup ??
        (FAMILY_ANCHORS.has(anchor)
          ? "settings-family"
          : PRIVACY_ANCHORS.has(anchor)
            ? "settings-privacy"
            : undefined);
      if (group && (group !== "settings-family" || isParent))
        setActiveSection(group);
      else if (isParent && params.get("setup") === "ai")
        setActiveSection("settings-family");
    };
    selectAnchor();
    window.addEventListener("hashchange", selectAnchor);
    return () => window.removeEventListener("hashchange", selectAnchor);
  }, [calendarSync, isParent, loading]);
  useEffect(() => {
    if (familySectionActive) setFamilyContentMounted(true);
    if (activeSection === "settings-privacy") setPrivacyContentMounted(true);
  }, [activeSection, familySectionActive]);
  useEffect(() => {
    const revealAnchor = () => {
      const target = document.getElementById(window.location.hash.slice(1));
      if (
        target?.closest<HTMLElement>("[data-settings-group]")?.dataset
          .settingsGroup !== activeSection
      )
        return false;
      let parent: HTMLElement | null = target;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target?.scrollIntoView({ block: "start" });
      return Boolean(target);
    };
    let observer: MutationObserver | null = null;
    const frame = requestAnimationFrame(() => {
      const anchor = window.location.hash.slice(1);
      if (!anchor) return;
      if (revealAnchor()) return;
      if (!FAMILY_ANCHORS.has(anchor) && !PRIVACY_ANCHORS.has(anchor)) return;
      // A lazy child can add the target after this effect's first frame. Watch
      // only long enough to hand the same canonical focus/open behaviour to it.
      observer = new MutationObserver(() => {
        if (revealAnchor()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeSection, familyContentReady, loading]);
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [age, setAge] = useState("");
  // Auto (follow the device) unless this device saved a choice (O-43). Read
  // after mount: localStorage does not exist on the server.
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(readThemePreference());
  }, []);

  // Saved only when the person picks one, so opening Settings never turns
  // the default (Auto) into a stored choice.
  const chooseTheme = (next: ThemePreference) => {
    setTheme(next);
    writeThemePreference(next);
    applyThemePreference(next);
  };
  const { locale, setLocale, t, clockFormat, setClockFormat, clockRemembered } = useTranslation();
  const displayLocale = useDisplayLocale();
  const themeLabels = {
    light: t("preferences.themeLight"),
    dark: t("preferences.themeDark"),
    auto: t("preferences.themeAuto"),
  };
  // Mount household sections only after the first profile load; otherwise the
  // transient loading return unmounts them and loses one-shot OAuth feedback.
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: SettingsFeedback;
  } | null>(null);

  // Calendar feed state. Parents only — the API enforces that too.
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [feedError, setFeedError] = useState<SettingsFeedback | null>(null);

  // AI capture provider state. The key is never loaded back into the form —
  // the API returns only a masked hint, so the field stays empty on load.
  const [aiProviderRevision, setAiProviderRevision] = useState(0);
  const [aiKey, setAiKey] = useState("");
  const [aiKeyHint, setAiKeyHint] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<SettingsFeedback | null>(null);
  const [aiError, setAiError] = useState<SettingsFeedback | null>(null);

  const feedUrl =
    feedToken && typeof window !== "undefined"
      ? `${window.location.origin}/api/calendar/feed?token=${feedToken}`
      : "";
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<SettingsFeedback | null>(
    null,
  );
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Data export and account deletion (docs/product/ACCOUNT_DELETION.md).
  const [exportState, setExportState] = useState<"idle" | "working" | "error">(
    "idle",
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const handleExport = async () => {
    setExportState("working");
    try {
      await downloadMyData();
      setExportState("idle");
    } catch {
      setExportState("error");
    }
  };

  // Load user data
  useEffect(() => {
    loadUserData();
  }, []);

  // Which server build is running (GET /api/version: { version, commit, builtAt }).
  // Purely informational, so any failure just leaves the line out.
  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (
          !d ||
          typeof d.version !== "string" ||
          !d.version ||
          d.version === "unknown"
        )
          return;
        const commit =
          typeof d.commit === "string" && d.commit !== "unknown"
            ? d.commit.slice(0, 7)
            : "";
        setBuild(commit ? `${d.version} (${commit})` : d.version);
      })
      .catch(() => {});
  }, []);

  // Load the family's calendar feed token, if one exists. Parents only — the
  // API refuses everyone else too.
  useEffect(() => {
    if (!isParent || !familyContentReady) return;
    fetch("/api/family/feed-token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.feedToken === "string" && d.feedToken)
          setFeedToken(d.feedToken);
      })
      .catch(() => {});
  }, [familyContentReady, isParent]);

  // Load AI capture settings (masked hint only — never the key itself). Parents
  // only, and only after the family group is selected (see aiCaptureSettings).
  const showAi = isParent && aiCaptureSettings && familyContentReady;
  useEffect(() => {
    if (!showAi) return;
    fetch("/api/family/ai-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setAiConfigured(Boolean(d.configured));
        setAiKeyHint(d.keyHint ?? null);
        setAiBaseUrl(d.baseUrl ?? "");
        setAiModel(d.model ?? "");
      })
      .catch(() => {});
  }, [showAi]);

  const saveAiSettings = async (clear = false) => {
    setAiBusy(true);
    setAiError(null);
    setAiMessage(null);
    try {
      const res = await fetch("/api/family/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear
            ? { clear: true }
            : {
                apiKey: aiKey.trim(),
                baseUrl: aiBaseUrl.trim(),
                model: aiModel.trim(),
              },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new SettingsFeedbackError(
          settingsResponseError(data.error, "aiSaveFailed"),
        );
      setAiConfigured(Boolean(data.configured));
      setAiKeyHint(data.keyHint ?? null);
      setAiKey("");
      setAiProviderRevision((value) => value + 1);
      setAiMessage(settingsFeedback(clear ? "aiRemoved" : "saved"));
      setTimeout(() => setAiMessage(null), 2500);
    } catch (e) {
      setAiError(settingsError(e, "aiSaveFailed"));
    } finally {
      setAiBusy(false);
    }
  };

  // Create the token, or regenerate it to revoke the old link.
  const handleFeedToken = async (regenerate: boolean) => {
    setFeedBusy(true);
    setFeedError(null);
    try {
      const res = await fetch("/api/family/feed-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.feedToken) {
        throw new SettingsFeedbackError(
          settingsResponseError(data.error, "feedFailed"),
        );
      }
      setFeedToken(data.feedToken);
    } catch (e) {
      setFeedError(settingsError(e, "feedFailed"));
    } finally {
      setFeedBusy(false);
    }
  };

  const copyFeedUrl = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 2000);
    } catch {
      setFeedError(settingsFeedback("copyFailed"));
    }
  };

  const loadUserData = async () => {
    // The first profile request controls the page-level loading shell. A
    // retry happens after the Settings tree is mounted; keep its other
    // sections mounted so one-shot OAuth feedback and drafts are not lost.
    const showPageLoader = loading && profileLoadState === "loading";
    if (showPageLoader) setLoading(true);
    setProfileLoadState("loading");
    setProfileLoadError(null);
    try {
      const res = await fetch("/api/users");
      const data = await res.json().catch(() => null);
      const profile = res.ok ? readUserProfilePayload(data) : null;
      if (!profile) throw new Error("Invalid profile response");

      setName(profile.name);
      setEmail(profile.email ?? "");
      setRole(profile.role);
      setAge(profile.age === null ? "" : String(profile.age));
      setProfileLoadState("ready");
    } catch (err) {
      console.error("Error loading user data:", err);
      setProfileLoadState("error");
      setProfileLoadError(settingsFeedback("profileLoadFailed"));
    } finally {
      if (showPageLoader) setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileLoadState !== "ready") return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          age: age ? parseInt(age) : null,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Show the server's reason (for example "Age must be between 1 and 150").
        setMessage({
          type: "error",
          text: settingsResponseError(data.error, "profileFailed"),
        });
        return;
      }

      setMessage({ type: "success", text: settingsFeedback("profileUpdated") });
      // The nav avatar initials and name come from the server layout.
      router.refresh();
    } catch (err) {
      console.error("Error saving profile:", err);
      setMessage({ type: "error", text: settingsFeedback("profileFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const currentPassword = String(fields.get("currentPassword") ?? "");
    const newPassword = String(fields.get("newPassword") ?? "");
    const confirmNewPassword = String(fields.get("confirmNewPassword") ?? "");
    setPasswordError(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordError(settingsFeedback("passwordMismatch"));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(settingsFeedback("passwordShort"));
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new SettingsFeedbackError(
          settingsResponseError(data.error, "passwordFailed"),
        );

      setPasswordSuccess(true);
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (err) {
      setPasswordError(settingsError(err, "passwordFailed"));
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">{copy("loading")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-large-title text-label-primary">{copy("title")}</h1>
        <p className="mt-2 text-muted-foreground">
          {isParent ? copy("parentIntro") : copy("personalIntro")}
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === "success"
              ? "bg-[var(--success-tint)] text-foreground border border-[var(--success)]"
              : "bg-[var(--danger-tint)] text-danger-text border border-[var(--danger-tint)]"
          }`}
        >
          <SettingsText feedback={message.text} />
        </div>
      )}

      {profileLoadState === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--danger-tint)] bg-[var(--danger-tint)] p-4 text-danger-text"
        >
          <SettingsText
            feedback={profileLoadError ?? settingsFeedback("profileLoadFailed")}
          />
          <button
            type="button"
            onClick={() => void loadUserData()}
            className="btn-secondary inline-flex min-h-[44px] items-center"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy("retryProfile")}
          </button>
        </div>
      )}

      <nav aria-label={copy("title")} className="flex flex-wrap gap-2">
        {(["account", ...(isParent ? ["family"] : []), "privacy"] as const).map(
          (section) => {
            const id = `settings-${section}`;
            return (
              <button
                type="button"
                key={section}
                aria-pressed={activeSection === id}
                onClick={() => {
                  hasExplicitSectionChoice.current = true;
                  setActiveSection(id);
                  window.history.replaceState(
                    window.history.state,
                    "",
                    `${window.location.pathname}${window.location.search}#${id}`,
                  );
                }}
                className={`min-h-[44px] rounded-full px-5 py-2 text-subhead font-semibold ${activeSection === id ? "bg-[var(--accent-fill)] text-[var(--on-accent)]" : "bg-[var(--surface-fill)] text-label-primary"}`}
              >
                {copy(
                  section === "account"
                    ? "account"
                    : section === "family"
                      ? "family"
                      : "privacyData",
                )}
              </button>
            );
          },
        )}
      </nav>

      {/* 1. Your account: personal to whoever is signed in (parent or teen). */}
      <SettingsGroup
        id="settings-account"
        title={copy("account")}
        active={activeSection === "settings-account"}
      >
        <div className="card">
          <CardHeader icon={User} tone="blue" title={copy("profile")} />

          <form onSubmit={handleSaveProfile} className="space-y-5">
            <div>
              <label
                htmlFor="profileName"
                className="block text-sm font-medium text-foreground mb-2"
              >
                {copy("fullName")}
              </label>
              <input
                id="profileName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={profileLoadState !== "ready"}
                className="input-field"
                placeholder={copy("namePlaceholder")}
              />
            </div>
            <div>
              <label
                htmlFor="profileAge"
                className="block text-sm font-medium text-foreground mb-2"
              >
                {copy("age")}{" "}
                <span className="font-normal text-label-tertiary">
                  {copy("optional")}
                </span>
              </label>
              <input
                id="profileAge"
                type="number"
                min="1"
                max="120"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                disabled={profileLoadState !== "ready"}
                className="input-field"
                placeholder={copy("agePlaceholder")}
              />
            </div>
            {/* Read-only facts: email changes go through support, roles through a parent. */}
            <dl className="space-y-1 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">{copy("email")}</dt>
                <dd className="min-w-0 break-words">{email}</dd>
              </div>
              {role && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-foreground">
                    {copy("role")}
                  </dt>
                  <dd className="capitalize">{role}</dd>
                </div>
              )}
            </dl>

            <button
              type="submit"
              disabled={saving || profileLoadState !== "ready"}
              className="btn-primary inline-flex items-center min-h-[44px]"
            >
              <Save className="w-4 h-4 mr-2" aria-hidden="true" />
              {saving ? copy("saving") : copy("saveProfile")}
            </button>
          </form>
        </div>

        <div className="card">
          <CardHeader
            icon={KeyRound}
            tone="red"
            title={copy("password")}
            description={copy("passwordDescription")}
          />
          <button
            type="button"
            onClick={() => setShowPasswordModal(true)}
            className="btn-secondary min-h-[44px]"
          >
            {copy("changePassword")}
          </button>
        </div>

        <div className="card">
          <CardHeader
            icon={Globe}
            tone="green"
            title={t("preferences.language")}
          />
          <label htmlFor="preferredLanguage" className="sr-only">
            {t("preferences.preferredLanguage")}
          </label>
          <select
            id="preferredLanguage"
            value={locale}
            onChange={(e) => {
              // Saved on this device by the root I18nProvider; applies at once.
              if (isLocale(e.target.value)) setLocale(e.target.value);
            }}
            className="input-field w-full"
          >
            <option value="en">{t("preferences.languageEnglish")}</option>
            <option value="es">{t("preferences.languageSpanish")}</option>
          </select>
          <label htmlFor="clockFormat" className="mt-4 mb-2 block text-subhead text-label-primary">
            {t("preferences.clockFormat")}
          </label>
          <select id="clockFormat" value={clockFormat} className="input-field w-full"
            aria-describedby="clock-format-example clock-format-storage"
            onChange={(event) => { if (isClockFormat(event.target.value)) setClockFormat(event.target.value); }}>
            <option value="auto">{t("preferences.clockAuto")}</option>
            <option value="12h">{t("preferences.clock12")}</option>
            <option value="24h">{t("preferences.clock24")}</option>
          </select>
          <p id="clock-format-example" className="mt-2 text-footnote text-label-secondary">
            {t("preferences.clockExample", { time: new Date(Date.UTC(2000, 0, 1, 13, 5)).toLocaleTimeString(displayLocale,
              { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) })}
          </p>
          <p id="clock-format-storage" role="status" className="mt-2 text-footnote text-label-secondary">
            {!clockRemembered ? t("preferences.clockVisitOnly") : null}
          </p>
        </div>

        <div className="card">
          <CardHeader
            icon={Moon}
            tone="purple"
            title={t("preferences.theme")}
            description={t("preferences.themeDescription")}
          />
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label={t("preferences.theme")}
          >
            {(["light", "dark", "auto"] as const).map((themeOption) => (
              <button
                key={themeOption}
                type="button"
                onClick={() => chooseTheme(themeOption)}
                aria-pressed={theme === themeOption}
                className={`min-h-[44px] min-w-0 [overflow-wrap:anywhere] rounded-lg border-2 px-1 py-2 text-center font-medium text-foreground ${
                  theme === themeOption
                    ? "border-primary bg-[var(--accent-tint)]"
                    : "border-border hover:border-input"
                }`}
              >
                {themeLabels[themeOption]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-label-tertiary">
            {t("preferences.themeAutoHint")}
          </p>
        </div>

        <div className="card">
          <CardHeader
            icon={Bell}
            tone="yellow"
            title={copy("notifications")}
            description={copy("notificationsDescription")}
          />
          {/* Saved on your account (#286), so it follows you to every device. */}
          <NotificationPreferences />
        </div>
        <QuietDisplayControl />
      </SettingsGroup>

      {/* 2. Family: household-level, parents only. Not rendered for a teen and
          none of its data is fetched (the APIs refuse teens regardless). */}
      {isParent && (
        <SettingsGroup
          id="settings-family"
          title={copy("family")}
          active={activeSection === "settings-family"}
        >
          <div className="card">
            <div className="-mx-3 space-y-1">
              <Link href="/dashboard/family/settings" className={rowClass}>
                <Home
                  className="w-4 h-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-medium">{copy("household")}</div>
                  <div className="text-xs text-label-tertiary">
                    {copy("householdDescription")}
                  </div>
                </div>
              </Link>
              <Link href="/dashboard/family" className={rowClass}>
                <Users
                  className="w-4 h-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-medium">{copy("members")}</div>
                  <div className="text-xs text-label-tertiary">
                    {copy("membersDescription")}
                  </div>
                </div>
              </Link>
              <Link href="/dashboard/family/invite" className={rowClass}>
                <UserPlus
                  className="w-4 h-4 shrink-0 text-success-text"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-medium">{copy("invite")}</div>
                  <div className="text-xs text-label-tertiary">
                    {copy("inviteDescription")}
                  </div>
                </div>
              </Link>
              <Link href="/dashboard/features" className={rowClass}>
                <Sliders
                  className="w-4 h-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-medium">{copy("features")}</div>
                  <div className="text-xs text-label-tertiary">
                    {copy("featuresDescription")}
                  </div>
                </div>
              </Link>
              <Link href="/dashboard/settings/imports" className={rowClass}>
                <Database
                  className="w-4 h-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-medium">{copy("imports")}</div>
                  <div className="text-xs text-label-tertiary">
                    {copy("importsDescription")}
                  </div>
                </div>
              </Link>
              {/* Household audit history, #285. The page and API are parent-only too. */}
              <Link href="/dashboard/settings/activity" className={rowClass}>
                <History
                  className="w-4 h-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-medium">{copy("recentChanges")}</div>
                  <div className="text-xs text-label-tertiary">
                    {copy("recentDescription")}
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* Shared tablets (#241): only while the kill switch is on (decided in ./page.tsx). */}
          {sharedDevice && familyContentReady && (
            <div className="card">
              <CardHeader
                icon={TabletSmartphone}
                tone="blue"
                title={copy("familyTablet")}
              />
              <div className="-mx-3 space-y-1">
                <Suspense
                  fallback={
                    <p role="status" className="text-sm text-muted-foreground">
                      {copy("loading")}
                    </p>
                  }
                >
                  <LazySharedDeviceSettings
                    initialHasPin={sharedDevice.hasPin}
                  />
                </Suspense>
              </div>
            </div>
          )}

          {/* Calendar feed: a household link (API-enforced parent-only). */}
          <SettingsDisclosure
            title={copy("feed")}
            description={copy("feedDescription")}
            icon={<SettingsIcon icon={CalendarDays} tone="sky" />}
            forceOpen={Boolean(feedError)}
          >
            {feedToken ? (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="feedUrl"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    {copy("privateLink")}
                  </label>
                  <input
                    id="feedUrl"
                    readOnly
                    value={feedUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input-field w-full text-xs font-mono scroll-mt-24"
                  />
                  <p className="text-xs text-label-tertiary mt-2">
                    {copy("linkPrivacy")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={copyFeedUrl}
                    className="btn-primary inline-flex items-center min-h-[44px]"
                  >
                    {feedCopied ? (
                      <Check className="w-4 h-4 mr-2" />
                    ) : (
                      <Copy className="w-4 h-4 mr-2" />
                    )}
                    {feedCopied ? copy("copied") : copy("copyLink")}
                  </button>
                  <button
                    onClick={() => handleFeedToken(true)}
                    disabled={feedBusy}
                    className="inline-flex items-center min-h-[44px] px-4 py-2 rounded-lg border border-input text-foreground hover:bg-muted"
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-2 ${feedBusy ? "animate-spin" : ""}`}
                    />
                    {copy("resetLink")}
                  </button>
                </div>

                <p className="text-xs text-label-tertiary">
                  {copy("resetDescription")}
                </p>

                <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  <div className="font-medium text-foreground mb-1">
                    {copy("feedInstructions")}
                  </div>
                  <div>{copy("googleInstructions")}</div>
                  <div>{copy("appleInstructions")}</div>
                  <div>{copy("outlookInstructions")}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {copy("createDescription")}
                </p>
                <button
                  onClick={() => handleFeedToken(false)}
                  disabled={feedBusy}
                  className="btn-primary inline-flex items-center min-h-[44px]"
                >
                  <RefreshCw
                    className={`w-4 h-4 mr-2 ${feedBusy ? "animate-spin" : ""}`}
                  />
                  {feedBusy ? copy("creating") : copy("createFeed")}
                </button>
              </div>
            )}

            {calendarFeedReviewScope && <Suspense fallback={<p role="status">{copy("loadingEllipsis")}</p>}>
              <LazyCalendarFeedReview key={calendarFeedReviewScope} scope={calendarFeedReviewScope} />
            </Suspense>}

            {feedError && (
              <p className="text-sm text-danger-text mt-3">
                <SettingsText feedback={feedError} />
              </p>
            )}
          </SettingsDisclosure>

          {/* Subscribed (read-only ICS) calendars, #232. The API enforces parent-only too. */}
          {familyContentReady && (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {copy("loading")}
                </p>
              }
            >
              <LazyCalendarSubscriptionsSection />
            </Suspense>
          )}

          {/* Two-way Google/Outlook sync, #264. Hidden unless the server has it configured. */}
          {calendarSync && (familyContentReady || hasCalendarReturn) && (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {copy("loading")}
                </p>
              }
            >
              <LazyCalendarSyncSection
                onProviderReturn={revealCalendarReturn}
              />
            </Suspense>
          )}

          {aiUsage && isParent && familyContentReady && (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {copy("loading")}
                </p>
              }
            >
              <LazyAiUsagePanel
                identity={aiUsage}
                refreshKey={aiProviderRevision}
              />
            </Suspense>
          )}

          {/* AI capture: the household's provider key. Only when the deployment
              turns the form on, a key is already saved, or a parent follows the explicit AI setup link. */}
          {aiCaptureSettings && (
            <SettingsDisclosure
              id="ai-capture"
              title={copy("aiCapture")}
              description={copy("aiDescription")}
              icon={<SettingsIcon icon={Sparkles} tone="violet" />}
              forceOpen={Boolean(aiError)}
            >
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="aiKey"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    {copy("apiKey")}
                  </label>
                  <input
                    id="aiKey"
                    type="password"
                    autoComplete="off"
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    placeholder={
                      aiConfigured
                        ? copy("savedKeyHint", { hint: String(aiKeyHint) })
                        : copy("pasteKey")
                    }
                    className="input-field w-full font-mono text-sm"
                  />
                  <p className="text-xs text-label-tertiary mt-2">
                    {copy("keyPrivacy")}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="aiBaseUrl"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    {copy("providerUrl")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {copy("optional")}
                    </span>
                  </label>
                  <input
                    id="aiBaseUrl"
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder={copy("providerUrlPlaceholder")}
                    className="input-field w-full text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="aiModel"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    {copy("model")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {copy("optional")}
                    </span>
                  </label>
                  <input
                    id="aiModel"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder={copy("modelPlaceholder")}
                    className="input-field w-full text-sm"
                  />
                </div>

                <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  <div className="font-medium text-foreground mb-1">
                    {copy("visionHint")}
                  </div>
                  <div>{copy("geminiHint")}</div>
                  <div>{copy("openaiHint")}</div>
                  <div>{copy("deepseekHint")}</div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => saveAiSettings(false)}
                    disabled={aiBusy || (!aiKey.trim() && !aiConfigured)}
                    className="btn-primary inline-flex items-center min-h-[44px]"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {aiBusy ? copy("savingEllipsis") : copy("save")}
                  </button>
                  {aiConfigured && (
                    <button
                      onClick={() => saveAiSettings(true)}
                      disabled={aiBusy}
                      className="min-h-[44px] px-2 text-sm text-danger-text hover:underline"
                    >
                      {copy("removeKey")}
                    </button>
                  )}
                  {aiMessage && (
                    <span className="text-sm text-success-text inline-flex items-center">
                      <Check className="w-4 h-4 mr-1" />{" "}
                      <SettingsText feedback={aiMessage} />
                    </span>
                  )}
                </div>

                {aiError && (
                  <p className="text-sm text-danger-text">
                    <SettingsText feedback={aiError} />
                  </p>
                )}
              </div>
            </SettingsDisclosure>
          )}
        </SettingsGroup>
      )}

      {/* 3. Privacy & data: a teen sees only their own export and deletion. */}
      <SettingsGroup
        id="settings-privacy"
        title={copy("privacyData")}
        active={activeSection === "settings-privacy"}
      >
        <div className="card">
          <div className="-mx-3 space-y-1">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exportState === "working"}
              className={rowClass}
            >
              <Download
                className="w-4 h-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <div className="font-medium">
                  {exportState === "working"
                    ? copy("preparingData")
                    : copy("dataExport")}
                </div>
                <div className="text-xs text-label-tertiary">
                  {copy("exportDescription")}
                </div>
              </div>
            </button>
            {exportState === "error" && (
              <p role="alert" className="px-3 text-sm text-danger-text">
                {copy("exportFailed")}
              </p>
            )}
            {/* Beta usage counts (#287): parents only; PATCH /api/family/beta-metrics enforces it too. */}
            {isParent && betaMetrics && privacyContentReady && (
              <Suspense
                fallback={
                  <p role="status" className="text-sm text-muted-foreground">
                    {copy("loading")}
                  </p>
                }
              >
                <LazyBetaMetricsSwitch initialEnabled={betaMetrics.enabled} />
              </Suspense>
            )}
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className={`${rowClass} !text-danger-text hover:bg-[var(--danger-tint)]`}
            >
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="font-medium">{copy("deleteAccount")}</span>
            </button>
          </div>
        </div>
      </SettingsGroup>

      {/* App Info */}
      <div className="rounded-xl bg-muted p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">{PRODUCT_BRAND.wordmark}</p>
        {build && <p>{copy("version", { build })}</p>}
        <p className="mt-1 text-label-tertiary">
          {copy("copyright", {
            year: new Date().getFullYear(),
            brand: PRODUCT_BRAND.legacyName,
          })}
        </p>
      </div>

      {/* A teen deletes only their own account; the household option is a parent's. */}
      <LazyDeleteAccountDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        allowHousehold={isParent}
      />

      {/* Change Password Modal */}
      <Dialog
        closeLabel={copy("close")}
        open={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setPasswordError(null);
          setPasswordSuccess(false);
        }}
        title={copy("changePassword")}
      >
        {passwordSuccess ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-[var(--success-tint)] rounded-full flex items-center justify-center mx-auto mb-4">
              <KeyRound
                className="w-8 h-8 text-success-text"
                aria-hidden="true"
              />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              {copy("passwordChanged")}
            </h3>
            <p className="text-muted-foreground mt-2">
              {copy("passwordUpdated")}
            </p>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            {passwordError && (
              <div className="bg-[var(--danger-tint)] border border-[var(--danger-tint)] text-danger-text px-4 py-3 rounded-md">
                <SettingsText feedback={passwordError} />
              </div>
            )}
            <div>
              <label
                htmlFor="currentPassword"
                className="block text-sm font-medium text-foreground mb-2"
              >
                {copy("currentPassword")}
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                className="input-field"
                autoComplete="current-password"
              />
            </div>
            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium text-foreground mb-2"
              >
                {copy("newPassword")}
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                className="input-field"
                autoComplete="new-password"
                minLength={8}
              />
              <p className="mt-1 text-xs text-label-tertiary">
                {copy("passwordHint")}
              </p>
            </div>
            <div>
              <label
                htmlFor="confirmNewPassword"
                className="block text-sm font-medium text-foreground mb-2"
              >
                {copy("confirmPassword")}
              </label>
              <input
                id="confirmNewPassword"
                name="confirmNewPassword"
                type="password"
                required
                className="input-field"
                autoComplete="new-password"
              />
            </div>
            <div className="flex space-x-4 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordError(null);
                }}
                className="btn-secondary flex-1"
              >
                {copy("cancel")}
              </button>
              <button
                type="submit"
                disabled={changingPassword}
                className="btn-primary flex-1"
              >
                {changingPassword ? copy("changing") : copy("changePassword")}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
