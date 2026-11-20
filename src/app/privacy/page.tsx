import type { Metadata } from 'next'
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage'
import { PRODUCT_BRAND } from '@/lib/brand'

const NAME = PRODUCT_BRAND.name

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${NAME} handles your household's information.`,
}

const link = 'text-primary underline underline-offset-2'

const sections: LegalSection[] = [
  {
    id: 'what-we-collect',
    title: 'What we keep',
    body: (
      <>
        <p>
          We keep what you put into {NAME} so the app can work: your name and email, the names of the people in
          your household, the chores, events, lists, meals, messages, rewards and photos you add, and progress such
          as points, streaks and finished chores.
        </p>
        <p>
          We do not show ads, sell your information or use tracking pixels. We do not record which pages or screens
          you open. Older versions of the app kept a log of page visits; those records are deleted 90 days after they
          were made.
        </p>
      </>
    ),
  },
  {
    id: 'where-it-lives',
    title: 'Where your information is kept',
    body: (
      <>
        <p>
          {NAME} runs on Cloudflare, our hosting provider. The app runs on Cloudflare Workers, your household&apos;s
          information is stored in a Cloudflare D1 database, and photos and files you upload are kept in private
          Cloudflare R2 storage. Uploads are not public: the app only shows them to signed-in members of your
          household.
        </p>
        <p>
          Passwords are stored in a scrambled form that cannot be turned back into the password. You confirm your
          email address before you can sign in, and we limit repeated attempts to protect accounts.
        </p>
      </>
    ),
  },
  {
    id: 'food-inventory',
    title: 'Food inventory',
    body: (
      <p>
        If your household turns on the food inventory, we keep the items you add (name, amount, where it is kept,
        category, best-before or use-by date, and when it was bought or opened) and a short history of what was used
        up or thrown away, with who did it and when, so it can be undone. Everyone in the household can see it, and
        it is part of every member&apos;s data download. It is deleted with the household. Removing an item also
        removes its history.
      </p>
    ),
  },
  {
    id: 'ai-features',
    title: 'AI features (optional)',
    body: (
      <>
        <p>
          <strong>Fridge photo scan.</strong> If it is turned on, a parent can photograph the fridge, freezer or
          pantry to get suggested food items. The photo is sent to our AI provider, Anthropic, only to read it, and
          {` ${NAME}`} does not save it. You review the suggestions and choose what to add.
        </p>
        <p>
          <strong>Importing events from text, photos or PDFs.</strong> If it is turned on, a parent can paste the
          text of a school email or flyer, or choose a photo or PDF of it, to get suggested calendar events. The text
          or file is sent to Anthropic only to read it, and {NAME} does not save it. Nothing is added to your calendar
          until you review the suggestions and choose what to add, and you can undo an import for a few minutes
          afterwards.
        </p>
        <p>
          Both features are off unless they have been set up, and you can always add things by hand instead.
        </p>
      </>
    ),
  },
  {
    id: 'weather',
    title: 'Weather on the Today board (optional)',
    body: (
      <p>
        Weather is off unless a parent turns it on in Family settings. When it is on, our server sends the place the
        parent chose, rounded to about 1 km, to Open-Meteo (open-meteo.com) to get the forecast. It also sends the
        place name a parent types when searching for a town. No names, accounts or other household information are
        sent. Turning weather off or removing the place stops these requests and deletes the saved forecast.
      </p>
    ),
  },
  {
    id: 'fridge-photos',
    title: 'Family photos on the fridge board (optional)',
    body: (
      <p>
        A parent can choose photos your household has already uploaded to show on the calm screen of the fridge
        board when it is left alone. They are shown only to signed-in members of your household, never on a paired
        shared tablet, and never sent to anyone else. No photos are shown unless a parent picks them, and the calm
        screen never shows ads.
      </p>
    ),
  },
  {
    id: 'calendars',
    title: 'Connected Google or Outlook calendars (optional)',
    body: (
      <p>
        A parent can connect their own Google Calendar or Outlook calendar in Settings. Only then, and only for the
        one calendar they choose, {NAME} reads and writes events with Google or Microsoft: it brings that
        calendar&apos;s events into the family calendar and, if the parent turns it on, adds family events to it.
        Each event shares its title, time, place and notes. We keep the access Google or Microsoft gives us encrypted
        and use it only for this sync. We do not read your other calendars, email or contacts. Disconnecting in
        Settings stops the sync, removes the events it brought in, and asks Google to cancel the access. Use of
        information received from Google follows the Google API Services User Data Policy, including its Limited Use
        requirements.
      </p>
    ),
  },
  {
    id: 'email',
    title: 'Email',
    body: (
      <>
        <p>
          We only send emails you need: confirming your email address, resetting your password, household invites
          and the notifications you have left on. We never send marketing email. You can turn notification emails off
          in Settings.
        </p>
        <p>
          If you turn on the morning summary (Settings, Notifications; it is off unless you turn it on), we also send
          you one short email a day, to a confirmed address only, with your own chores for the day, today&apos;s
          family events and tonight&apos;s dinner. Every summary email tells you how to turn it off.
        </p>
        <p>
          Emails are sent through Mailgun, our email provider. To deliver a message, Mailgun receives the
          recipient&apos;s address and name and the message itself. We have turned off Mailgun&apos;s open and click
          tracking, so it does not track whether you open an email or change the links in it.
        </p>
      </>
    ),
  },
  {
    id: 'change-history',
    title: 'Household change history',
    body: (
      <p>
        When someone changes household settings (turns a feature on or off, sends or cancels an invite, joins the
        household or deletes their account, changes the Today board, turns beta usage counts on or off, or pairs,
        renames or removes a family tablet), we keep a short line saying what changed, who did it and when. It holds
        names (of a feature, a member or a tablet) but never email addresses, codes, places or messages. Only parents
        can see it, under Settings, Recent changes. It is kept for 12 months and then deleted, and it is deleted with
        the household. It is part of a parent&apos;s data download; a teen&apos;s or child&apos;s download has only
        the lines about their own changes.
      </p>
    ),
  },
  {
    id: 'beta-usage-counts',
    title: 'Beta usage counts (optional)',
    body: (
      <>
        <p>
          While {NAME} is in a small beta, a parent can choose to share usage counts so we can check the app is
          working for families. They are off unless a parent turns them on under Settings, Privacy &amp; data,
          &quot;Share beta usage counts&quot;. When they are on, we keep one number per day for your household for
          each of these: events added, meals planned, chores assigned, chores completed, chores checked by a parent,
          rewards claimed, members who joined, and whether the household&apos;s first chore was assigned within 10
          minutes of signing up. That is all: no names, no user accounts, no roles, no chore, event, meal or reward
          titles, no messages or photos, and nothing about which member did what.
        </p>
        <p>
          The counts are kept for 13 months. Older days are never used, and are deleted the next time your
          household&apos;s counts change. Turning the setting off deletes all of your household&apos;s counts straight
          away, and they are deleted with the household. They are part of every member&apos;s data download. They are
          never sold or shared with anyone, and they are separate from any other analytics.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children’s information',
    body: (
      <p>
        {NAME} is made for families with children. Accounts for children under 13 must be created by a parent. We do
        not knowingly collect information from children directly. If you think a child&apos;s account was created
        without a parent&apos;s permission, contact us to have it removed.
      </p>
    ),
  },
  {
    id: 'your-choices',
    title: 'Seeing, downloading and deleting your information',
    body: (
      <ul className="list-disc space-y-3 pl-6">
        <li>
          <strong>See and correct your details.</strong> Open Settings to see your profile and change your name.
        </li>
        <li>
          <strong>Download your data.</strong> In Settings, Privacy &amp; data, choose Data Export. You get one file
          with all your information that you can open or keep (JSON format). Each member of the household downloads
          their own copy.
        </li>
        <li>
          <strong>Delete your account.</strong> In Settings, Privacy &amp; data, choose Delete Account and confirm
          with your password. Your account, sign-ins, messages, notifications and your own chores are deleted. Things
          you added for the household (events, lists, meals, notes, photos you uploaded) stay with the household under
          another parent.
        </li>
        <li>
          <strong>Delete the household.</strong> If you are the only parent, you can delete the whole household from
          the same place. Every member account, all household information, uploaded photos, paired tablets,
          invitations and calendar connections are deleted, and old links (calendar feed, sitter share link) stop
          working. Short-lived security counters, such as limits on repeated sign-in attempts, expire on their own.
        </li>
        <li>
          <strong>Recovery copies.</strong> Our hosting provider keeps short-term recovery copies of the database.
          Deleted information can stay in those copies until they expire (up to about five weeks).
        </li>
      </ul>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        For privacy questions, or for help with any of the choices above, email{' '}
        <a href="mailto:privacy@ashbi.ca" className={link}>
          privacy@ashbi.ca
        </a>
        .
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      title="Privacy Policy"
      updated="November 2026"
      summary={[
        <>We keep what your household puts into {NAME} so the app can work. We do not show ads or sell your information.</>,
        <>
          {NAME} runs on Cloudflare. Your information is stored in a Cloudflare D1 database, and photos and files are
          kept in private storage that only your household can open through the app.
        </>,
        <>
          Some optional features share limited information with other services (Anthropic, Open-Meteo, Google or
          Microsoft). Each one is off unless it has been turned on.
        </>,
        <>Emails go through Mailgun, and we never send marketing email.</>,
        <>You can download your data or delete your account at any time in Settings, Privacy &amp; data.</>,
      ]}
      sections={sections}
    />
  )
}
