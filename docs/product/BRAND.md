# Warm Paper brand

Owner decision (Cameron, 2026-10-03): Family Planner keeps its name and takes on a "Warm Paper" look: cozy, crafted and editorial, with paper-cut and risograph illustrations. The brand voice and principles in `/BRAND.md` still apply; this page is the visual system. Tokens live in `src/app/globals.css`, illustrations in `src/lib/brand-illustrations.ts`, and the design gallery (`/dev/design-system`, `docs/design/DESIGN_GALLERY.md`) shows all of it.

## Palette

| Name | Hex | Role |
|---|---|---|
| Cream | `#FBF7F0` | Page background (`--surface-grouped`, `--brand-cream`) |
| Warm white | `#FFFDF9` | Cards, sheets, inputs (`--surface-elevated`) |
| Deep navy | `#1F2A44` | Ink (`--label-primary`) and primary buttons (`--accent-fill`, light) |
| Terracotta | `#C4623D` | Decoration and focus ring (`--brand-terracotta`, `--focus-ring`) |
| Terracotta deep | `#A3452A` | Links, tinted buttons, active tab (`--accent-text`, light) |
| Sage | `#4E7148` / `#8FB283` | Success fill and text / decoration (`--success`, `--brand-sage`) |
| Mustard | `#D9A33A` | Warnings and accents, never as text (`--warning`, `--brand-mustard`) |
| Night navy | `#121A2B` / `#1B2538` | Dark mode page / cards |
| Warm cream ink | `#F5EEDF` | Dark mode text |

Rules:

- Primary action: deep navy fill with cream text in light mode; a lifted "denim" navy `#4A6BA3` in dark mode, so it never looks like the red destructive button beside it.
- Terracotta marks what is active or tappable (links, the current tab, tinted buttons, today's ring). Sage means done. Red (`--danger-*`) stays for destructive actions and errors. Colour never carries meaning alone.
- Mustard and the light sage are decoration only; text uses the `-text` tokens.
- Module tints (glyphs, avatars, member colours) are earthy versions of the old hues: indigo ink, terracotta, sage, slate blue, berry, plum, ochre, teal, deep mustard. All carry white text at 6:1 or better.
- Focus ring: 2px gap in the surface colour, then 2px terracotta (`--shadow-focus`). It shows on cream pages and around navy buttons.
- `.on-paper` re-declares the light text tokens for text that always sits on cream artwork (the landing hero headline on large screens), in either theme.

### Contrast (WCAG 2.1, checked in CI)

`src/__tests__/brand-contrast.test.ts` reads both token blocks from `globals.css`, blends translucent tints over the surface they sit on, and fails if any pair drops below 4.5:1 (text) or 3:1 (icons, focus ring, non-text UI). Print this table with `BRAND_CONTRAST_TABLE=1 npx jest src/__tests__/brand-contrast`.

| Foreground | Background | Use | Light | Dark | Min |
|---|---|---|---|---|---|
| --label-primary | --surface-grouped | text | 13.35 | 15.04 | 4.5 |
| --label-primary | --surface-elevated | text | 14.03 | 13.28 | 4.5 |
| --label-primary | --surface-fill over --surface-elevated | text on fills/inputs | 12.28 | 10.31 | 4.5 |
| --label-secondary | --surface-grouped | text | 7.45 | 10.91 | 4.5 |
| --label-secondary | --surface-elevated | text | 7.83 | 9.64 | 4.5 |
| --label-secondary | --surface-fill over --surface-elevated | text on fills/inputs | 6.85 | 7.47 | 4.5 |
| --label-tertiary | --surface-grouped | text | 5.75 | 7.56 | 4.5 |
| --label-tertiary | --surface-elevated | text | 6.04 | 6.67 | 4.5 |
| --label-tertiary | --surface-fill over --surface-elevated | text on fills/inputs | 5.29 | 5.18 | 4.5 |
| --accent-text | --surface-grouped | links, active tab | 5.71 | 7.94 | 4.5 |
| --accent-text | --surface-elevated | links, active tab | 6.01 | 7.01 | 4.5 |
| --accent-text | --accent-tint over --surface-elevated | tinted button | 5.20 | 5.22 | 4.5 |
| --accent-text | --accent-tint over --surface-grouped | tinted button on page | 4.97 | 5.96 | 4.5 |
| --accent-text | --accent-tint-strong over --surface-elevated | tinted button hover | 4.71 | 4.80 | 4.5 |
| --on-accent | --accent-fill | filled button | 14.03 | 5.27 | 4.5 |
| --on-accent | --accent-fill-hover | filled button | 11.10 | 6.06 | 4.5 |
| --on-accent | --accent-fill-pressed | filled button | 16.69 | 7.18 | 4.5 |
| #FFFFFF | --accent-fill | white icon/text on accent | 14.26 | 5.35 | 4.5 |
| --on-accent | --danger-fill | destructive button | 6.99 | 6.99 | 4.5 |
| --on-accent | --danger-fill-pressed | destructive pressed | 8.90 | 8.90 | 4.5 |
| --danger-text | --surface-grouped | error text | 6.65 | 7.29 | 4.5 |
| --danger-text | --surface-elevated | error text | 6.99 | 6.44 | 4.5 |
| --danger-text | --danger-tint over --surface-elevated | error banner | 6.07 | 4.90 | 4.5 |
| --warning-text | --surface-grouped | warning text | 5.55 | 9.45 | 4.5 |
| --warning-text | --surface-elevated | warning text | 5.83 | 8.34 | 4.5 |
| --warning-text | --warning-tint over --surface-elevated | warning banner | 5.10 | 5.69 | 4.5 |
| --on-warning | --warning | text on mustard fill | 6.28 | 6.28 | 4.5 |
| --success-text | --surface-grouped | success text | 5.20 | 8.50 | 4.5 |
| --success-text | --surface-elevated | success text | 5.47 | 7.51 | 4.5 |
| --success | --surface-grouped | sage check fill | 5.20 | 5.41 | 3 |
| --success | --surface-elevated | sage check fill | 5.47 | 4.78 | 3 |
| --success-text | --success-tint over --surface-elevated | success banner | 4.62 | 5.60 | 4.5 |
| #FFFFFF | --success | check mark on sage | 5.56 | 3.21 | 3 |
| #FFFFFF | --tint-chore | white on glyph/avatar | 7.53 | 7.53 | 4.5 |
| #FFFFFF | --tint-calendar | white on glyph/avatar | 6.00 | 6.00 | 4.5 |
| #FFFFFF | --tint-lists | white on glyph/avatar | 6.51 | 6.51 | 4.5 |
| #FFFFFF | --tint-budget | white on glyph/avatar | 7.19 | 7.19 | 4.5 |
| #FFFFFF | --tint-messages | white on glyph/avatar | 6.43 | 6.43 | 4.5 |
| #FFFFFF | --tint-family | white on glyph/avatar | 6.53 | 6.53 | 4.5 |
| #FFFFFF | --tint-rewards | white on glyph/avatar | 6.25 | 6.25 | 4.5 |
| #FFFFFF | --tint-projects | white on glyph/avatar | 6.03 | 6.03 | 4.5 |
| #FFFFFF | --tint-meals | white on glyph/avatar | 6.24 | 6.24 | 4.5 |
| --tint-lists-text | --surface-grouped | tint as text | 6.10 | 8.50 | 4.5 |
| --tint-lists-text | --surface-elevated | tint as text | 6.41 | 7.51 | 4.5 |
| --tint-rewards-text | --surface-grouped | tint as text | 5.86 | 9.88 | 4.5 |
| --tint-rewards-text | --surface-elevated | tint as text | 6.16 | 8.73 | 4.5 |
| --focus-ring | --surface-grouped | focus ring | 3.81 | 7.94 | 3 |
| --focus-ring | --surface-elevated | focus ring | 4.00 | 7.01 | 3 |
| --accent-fill | --surface-grouped | filled button edge | 13.35 | 3.25 | 3 |

Landing hero text on the darkest wall tone of the kitchen art (`#E6CBA2`, `.on-paper`): ink 9.12:1, secondary `#3A4258` 6.39:1, link `#8F3C22` 4.73:1.

## Type

- Headings: **Fraunces** (variable serif, `SOFT` axis at 50), weight 600. Used by `.text-large-title`, `.text-title-1`, `.text-title-2`, `.text-title-3` and `.font-display` (the Today date and clock). Tracking is lighter than the old SF Pro settings (-0.014em at 34px down to -0.004em at 20px).
- Everything else: **Inter**.
- Sizes are unchanged (the Apple HIG scale).
- Both load through `next/font/google` in `src/app/layout.tsx`. Next.js downloads the files at build time and serves them from this origin, so browsers make no request to Google and the CSP (`font-src 'self' data:`) is unchanged. The build machine needs network access to Google Fonts.

## Illustrations

Style: warm paper-cut and risograph. Cream, terracotta, sage, deep navy and mustard, with visible paper grain. No people (a child's drawing on a wall is the one exception, in the sign-in art), no text, no brand marks, no holiday objects. Spot illustrations have a transparent background.

Generator: Higgsfield `gpt_image_2_5`, high quality, with the first approved sample as the style reference image. Prompt pattern:

> Warm paper-cut and risograph illustration, layered cut paper with soft paper grain, palette of warm cream, terracotta, sage green, deep navy and mustard. &lt;subject&gt;. Single centred object group, transparent background, no people, no text, no logos.

Files are compressed WebP (spots about 480px on the long side, 20 to 60 KB). Every use is decorative: `alt=""`, `aria-hidden`, lazy unless above the fold, explicit `width`/`height`, shown at about 160 to 200px on phones.

| Key (`ILLUSTRATIONS`) | File | Subject | Used in |
|---|---|---|---|
| `choresClear` | `chores-clear.webp` | Checklist, tea cup, fountain pen | Chores "All clear!" (dark mode, reduced motion; `tea` loop otherwise) |
| `calendarEmpty` | `calendar-empty.webp` | Desk calendar with a circled day, leaves | Calendar "No events" |
| `mealsEmpty` | `meals-empty.webp` | Cutting board, tomato, carrot, recipe card | Meals "No meals planned yet" (whole week empty); Lists filtered to meal plans |
| `groceriesClear` | `groceries-clear.webp` | Woven basket and lemon | Grocery list with no items; Lists filtered to Shopping |
| `listsEmpty` | `lists-empty.webp` | Clipboard and pencil | Lists "No lists yet"; any other empty list |
| `rewards` | `rewards.webp` | Gift box with stars | Rewards "No rewards yet" |
| `celebrate` | `celebrate.webp` | Rosette with star and confetti | Kid home "All done for today!" (still for the `celebrate` loop) |
| `notificationsQuiet` | `notifications-quiet.webp` | Bell, moon, stars | Notifications empty (still for the `moon` loop) |
| `messagesEmpty` | `messages-empty.webp` | Two speech bubbles with a heart | Messages "No messages yet" |
| `invite` | `invite.webp` | Open front door, plant, envelope | Invite page header |
| `help` | `help.webp` | Lighthouse | Help page header |
| `getStarted` | `get-started.webp` | Calendar, house, calendar, dotted path (wide) | Get started card (still for the `getStarted` loop) |
| `housesBanner` | `houses-banner.webp` | Row of houses (wide) | Landing page footer divider |
| — | `houses-banner-email.png` | Same, 600px PNG | Top of every transactional email |
| `authEntryway` | `auth-entryway.webp` | Entryway: bench, boots, backpack (4:5) | Sign in, sign up, forgot/reset password, verify email, md and up only |
| `heroKitchen` / `heroKitchenSmall` | `hero-kitchen-1600.webp` / `-800.webp` | Sunny kitchen, empty left third (16:9) | Landing hero still (srcset) |

Other brand files: `public/og-image.jpg` (1200×630, includes the words "Family Planner"), `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `public/favicon.ico`, `public/brand/favicon-32.png`, `public/brand/favicon-48.png`, and `public/favicon.svg` (hand-written SVG of the house mark that reads at 16px; also used as the in-app logo through `BrandMark`).

Android app icon (done): the Capacitor launcher icons in `android/app/src/main/res/` use the same house mark, cut from `public/icon-512.png`. The adaptive icon is a flat navy `#1F2A44` background (`values/ic_launcher_background.xml`) with the house on a transparent foreground (`mipmap-*/ic_launcher_foreground.png`, 108dp canvas, mark inside a 56dp circle so every launcher mask keeps it whole) and a single-colour `ic_launcher_monochrome.png` (heart and door cut out) for Android 13 themed icons. The legacy `ic_launcher.png` and `ic_launcher_round.png` (48dp, rounded square and circle) are the same art for Android 7 and 7.1. The splash is cream `#FBF7F0` with the navy house tile (`drawable*/splash.png` before Android 12, `windowSplashScreenBackground` in `values/styles.xml` from Android 12). The Play Store listing icon is still part of #163.

### Add an illustration

1. Generate with the same model, the style reference image and the prompt pattern above; one subject, transparent background.
2. Check it next to the existing set in the gallery: same palette, grain and light direction.
3. Export WebP at about 480px on the long side (quality around 80, under 60 KB) into `public/brand/illustrations/`.
4. Add it to `ILLUSTRATIONS` in `src/lib/brand-illustrations.ts` with its real pixel width and height, and to `ILLUSTRATION_USES` in the gallery.
5. Use it through `EmptyState illustration={…}` or `BrandIllustration`. Never put art inside dense lists or forms.
6. Add a row to the table above.

## Motion

Five short seamless loops in `public/brand/motion/`, each as VP9 WebM, H.264 MP4 and a poster frame, on a flat cream `#FBF7F0` ground (not transparent).

| Key (`MOTION`) | Files | Size | Used in |
|---|---|---|---|
| `celebrate` | `celebrate.*` | 360×360 | Kid home "All done for today!" |
| `tea` | `tea.*` | 360×360 | Chores "All clear!" |
| `moon` | `moon.*` | 360×360 | Notifications empty |
| `getStarted` | `getstarted.*` | 640 wide, 16:9 | Get started card banner |
| `hero` | `hero-1280.*`, `hero-720.*`, `hero-poster.webp` | 16:9 | Landing hero (1280 from 800px wide up, 720 below) |

`BrandMotion` (`src/components/ui/brand-motion.tsx`) renders `<video muted loop playsInline preload="none" poster>` with the WebM source first, then MP4; `aria-hidden`, explicit size, no controls. The server render and the first client render always show the still illustration (hydration-safe). After mount it switches to the video only when the app is in light mode (the cream ground would be a box on navy), the viewer has not asked for reduced motion (OS setting or the app's reduce-motion setting) and data saver is off. Spot loops play only while on screen (IntersectionObserver) and pause when scrolled away; the hero starts at once. CSP: there is no `media-src`, so `default-src 'self'` already allows these same-origin videos.

Generator: Higgsfield `kling3_0` pro, 5 seconds, with the same image as start and end frame for a seamless loop, from an opaque cream version of the still. Prompt pattern:

> Flat 2D paper-cut stop-motion animation, crisp and sharp, exactly the same artwork and flat cream background throughout: &lt;one small movement, e.g. steam curls rise from the tea&gt;; no glow, no blur, no vignette, no camera movement, no new objects, no text; seamless loop.

To add one: generate as above, encode WebM (VP9) and MP4 (H.264) plus a WebP poster, keep each under about 100 KB (the hero is the exception), add it to `MOTION` with its still, and use `BrandMotion` (or `EmptyState motion={…}`).

## Email

`src/lib/email-layout.ts` wraps the HTML part of every transactional email (invite, verify, resend verification, password reset): cream page, warm white card, navy text, serif heading, the houses banner (`${NEXT_PUBLIC_APP_URL}/brand/illustrations/houses-banner-email.png`, width 600, `alt=""`) at the top and a navy button. Plain-text parts are unchanged.
