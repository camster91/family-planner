# Design-Partner Beta Operations

The operating packet for the five-household beta: recruiting and onboarding (#107), weekly scorecards and exit interviews (#108). Success criteria live in `docs/PRODUCT_PROGRAM.md` ("North-star journey and metrics"); this file is how to run the beta, not what it must prove.

Issues #107 and #108 mention `docs/BETA_OPERATIONS_PACKET.md` and `docs/DESIGN_PARTNER_BETA.md`. Neither exists on `master`; this file replaces both.

**Approval boundary.** Contacting or recruiting anyone, reading production with the scorecard, and any change to a real account are Cameron's decisions (`AGENTS.md`). Agents prepare; they do not send, recruit or touch live data.

## Before the first household

All must be true:

- [ ] Verification and password-reset email work in production (#103, `docs/runbooks/TRANSACTIONAL_EMAIL.md`). Without it no new parent can sign in.
- [ ] Production is healthy on a reviewed release, with no open P0 or P1 incident.
- [ ] A current production backup has been restored in isolation (`docs/runbooks/BACKUPS.md`, "Restore test"). The daily backup timer is installed, or the owner has chosen another schedule.
- [ ] The private cohort map exists outside git (below).
- [ ] The support inbox is set up and someone reads it daily.

## Recruiting criteria

Five households. Each one:

- is **independent**: not Cameron's household, not a household with a Family Planner developer, not another household of the same family;
- has **one adult owner** (parent or guardian with authority for the household) who will register and hold the parent role;
- has **at least one child or teen** who will join and do chores;
- has an Android phone or tablet, or a phone browser, and will use the app for **four weeks**;
- has **no urgent need** for features the app lacks (for example location tracking or billing), so the test is fair;
- is **not paid** and not promised a price. The beta is free.

Legacy data: a household that wants to import from another app (for example ChoreChamps) needs a separate, written migration record first (source, what is imported, dry-run result, owner approval). Do not import during onboarding.

## Consent script

Read or send this to the adult owner before they sign up. Record the date and their "yes" in the private cohort map, not in GitHub.

> **Family Planner beta: what you are agreeing to**
>
> - **What it is.** Family Planner is a new app for household plans, chores and rewards. It is still being built. Things may break, change or be removed. Please do not rely on it for anything urgent, medical or safety-related.
> - **How long.** Four weeks, free. You can stop at any time without a reason.
> - **Who agrees.** You confirm you are an adult with authority for your household. You agree for any child or teen you add. Children under 13 must be added by you; please also tell your children in simple words what the app is and that they can say no.
> - **What we store.** What your family types in: names, email addresses, chores, events, lists, messages, rewards, photos you upload, and progress. Passwords are stored scrambled (hashed), never in plain text. Your household's data is kept separate from every other household's.
> - **Beta usage counts.** We will ask you to turn on "Share beta usage counts" in Settings. It keeps one number per day for your household: events added, meals planned, chores assigned, completed and checked, rewards claimed, members joined, and whether your first chore was assigned within 10 minutes of signing up. No names, no titles, no messages or photos, and nothing about which person did what. Turning it off deletes these counts straight away.
> - **Email.** Sign-up, password-reset and invite emails are sent through our email provider, Mailgun. It sees the address, the greeting name and the link.
> - **Optional features.** Weather, the fridge photo scan and importing events from a photo or PDF are off unless you turn them on. The privacy page explains what each one sends and to whom.
> - **Talking to us.** We may ask one short question each week and have one conversation at the end (about 30 minutes). We take notes without your children's names. We never share your answers with your name attached.
> - **At the end.** You can keep using the app, download your data, or delete your account or the whole household. Deleted data is gone from the app at once; it stays in our server backups for up to about five weeks until they are rotated out.
> - **Support.** Contact `<SUPPORT_EMAIL>`. We reply within one working day. If something looks wrong with privacy (for example you see another family's information), tell us straight away.
>
> Do you agree? (yes / no)

Owner checks before sending: `<SUPPORT_EMAIL>` is filled in; the backup wording matches what is actually installed; the privacy page (`src/app/privacy/page.tsx`) still matches this list.

## Private cohort map (template)

Keep this **outside git**, in the owner's private, access-controlled storage (for example an encrypted note or a private spreadsheet only Cameron can open). Never paste it into GitHub, logs, telemetry, chat with agents or the scorecard. Everywhere else, use only the cohort ID (`beta-01` to `beta-05`).

| Cohort ID | Household ID (from DB, for support only) | Adult owner name | Contact (email/phone) | Consent date | Kids/teens joined (count only) | Counts on (date) | First chore assigned (date) | Migration record? | Exit interview date | Exit choice (keep / export / delete) | Contact data deleted (date) |
| --------- | ---------------------------------------- | ---------------- | --------------------- | ------------ | ------------------------------ | ---------------- | --------------------------- | ----------------- | ------------------- | ------------------------------------ | --------------------------- |
| beta-01   |                                          |                  |                       |              |                                |                  |                             |                   |                     |                                      |                             |
| beta-02   |                                          |                  |                       |              |                                |                  |                             |                   |                     |                                      |                             |
| beta-03   |                                          |                  |                       |              |                                |                  |                             |                   |                     |                                      |                             |
| beta-04   |                                          |                  |                       |              |                                |                  |                             |                   |                     |                                      |                             |
| beta-05   |                                          |                  |                       |              |                                |                  |                             |                   |                     |                                      |                             |

Each cohort ID maps to exactly one household. The scorecard numbers households on its own (1 to 5, not these IDs), so it never needs this map.

## Onboarding checklist (per household)

Do this on a short call or by message. The adult does every step themselves on their own device; the operator never signs in as them.

1. [ ] Consent recorded (date, "yes") in the cohort map.
2. [ ] Adult registers at the production URL and clicks the verification email.
3. [ ] Adult creates the household.
4. [ ] **Right away**, adult turns on Settings → Privacy & data → "Share beta usage counts". (Counts start from this moment. Turning it on after the first chore loses the time-to-first-value measure for this household.)
5. [ ] Adult invites a child or teen: Family → Invite (`/dashboard/family/invite`), by email (role child or teen), or by family code for someone who already has a verified account.
6. [ ] The child or teen joins.
7. [ ] Adult assigns the first chore. Note the date in the cohort map. Do not time it by hand; the scorecard measures registration-to-first-chore.
8. [ ] Optional: pair a shared tablet (Settings → Devices).
9. [ ] Tell them the support address, and what to do if they see another family's data (stop, tell us, do not share screenshots publicly).
10. [ ] Do not coach them through the weekly loop. The beta measures whether they find it on their own.

## Support

- Contact: `<SUPPORT_EMAIL>` (placeholder; owner fills in, also in `src/lib/support.ts` for the in-app Help page). One inbox, read at least once a day.
- Step-by-step handling of each kind of request: `docs/runbooks/SUPPORT.md`.
- Reply within one working day. Privacy or "I can see another family" reports: reply and start the incident loop within one hour when awake.
- In issues and notes, refer to households only as `beta-0N`. Never copy messages, child names, photos, addresses or screenshots with personal data into GitHub.
- Operators do not join beta households and do not sign in as a member. If a fix needs someone's data, ask them to describe it or use the export they send you, then delete the export.

## Incidents

Use `docs/runbooks/INCIDENT_RESPONSE.md`. Beta severities:

| Level | Examples in the beta                                                                                                    | First response                            | Updates to affected households |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| SEV0  | Any sign one household can see or change another's data; account takeover; data loss                                    | Within 1 hour. **Stop condition** (below) | Same day, then daily           |
| SEV1  | Nobody can sign in or register; chores/rewards can't be saved; verification or reset email down; Android crash on start | Within 4 hours                            | Daily until fixed              |
| SEV2  | One feature broken with a workaround (weather, calendar sync, tablet display)                                           | Next working day                          | When fixed                     |
| SEV3  | Cosmetic issue, confusing wording                                                                                       | Weekly triage                             | Not needed                     |

**Stop condition (SEV0 cross-family access).** Pause the beta: tell households to stop using the app until further notice (owner sends it), halt releases, follow "Cross-household exposure" in the incident runbook, and do not restart until the fix and the two-household isolation tests pass. #108 requires zero confirmed cross-family access.

Cadence: a daily five-minute check of the support inbox and `docker logs` for 5xx errors on core routes while the beta runs; a weekly review with the scorecard. Record each incident as `beta-0N`, date, severity, area, fixed in which release. No private content.

## Weekly scorecard (#108)

Every Monday, for the four beta weeks (ISO weeks, Monday to Sunday, UTC):

1. **Get approval** to read production for this run (Cameron). The script is read-only (one `READ ONLY` transaction).
2. **Run it** from a machine that can reach the production database (for example through an SSH tunnel), with this Monday's date so the week just ended is the last complete week:

   ```bash
   BETA_SCORECARD_ALLOW_REMOTE=1 DATABASE_URL='<production url, from the private store>' \
     npm run beta:scorecard -- --as-of 2026-11-02
   BETA_SCORECARD_ALLOW_REMOTE=1 DATABASE_URL='...' \
     npm run beta:scorecard -- --as-of 2026-11-02 --json > scorecard-2026-11-02.json
   ```

   Do not keep the database URL in shell history (prefix the command with a space if `HISTCONTROL=ignorespace`, or use a private env file).

3. **Reliability** is always "INSUFFICIENT DATA" in the scorecard (counts record successes only). Take it from the server logs: 5xx answers on core routes (chores, events, meals, rewards, family join) divided by all requests to them, for the week. Target: at least 99% success.
4. **Freeze** the text and JSON output with the date, as that week's scorecard. The output has numbers only (households 1 to 5), so it may be posted to #108. Do not edit it afterwards; a correction is a new, dated run.
5. **Never fill gaps by guessing.** "INSUFFICIENT DATA" stays as it is.
6. **Ask each adult the weekly question**, exactly, with no hints or follow-up coaching:

   > "Thinking about the past week, how easy or hard was it to coordinate plans and chores in your household? (1 = very hard, 5 = very easy.) Anything you want to add?"

   Record the number and any comment in the private cohort store, by cohort ID.

7. **Check operations**: the newest backup is from the last day (`docs/runbooks/BACKUPS.md`); email delivery in Mailgun looks normal (`docs/runbooks/TRANSACTIONAL_EMAIL.md`); open incidents.
8. **Write a short weekly note** (issue comment or private doc): scorecard results, reliability, incidents by cohort ID and severity, friction answers as a count per score (not per household).

## Exit interview (template)

Thirty minutes with each adult owner, after week four, **before** any price is mentioned by us. Notes go in the private store, by cohort ID, with no children's names.

1. In your own words, what did you use Family Planner for?
2. Walk me through the last time you used it. What happened?
3. What did your children or teens think of it? What did they do without being asked?
4. What was confusing, annoying or missing?
5. What did you use before, and what do you use now alongside it?
6. If Family Planner went away tomorrow, what would you do instead? How would you feel?
7. Would you pay for it? (Ask as an open question; do not suggest a number.) If yes: what would make it worth paying for? If no: why not?
8. Only after they answer 7: What would you expect it to cost for the whole family per year?
9. Anything else we should know?

Record for each: would pay unprompted (yes / no / unsure), top three problems, top three valued things. #108 needs at least 3 of 5 to say yes to question 7 on their own before any billing work.

Decision after the fifth interview (owner): **extend**, **fix and repeat**, or **pricing validation**. Record the choice and the reason in #108.

## Offboarding and data deletion

For each household at the end (or when they leave early):

1. **Ask their choice**: keep using the app, download their data, delete one account, or delete the whole household.
2. **Export**: Settings → Data Export (or the "Download my data" step inside the delete dialog). Each member gets their own export.
3. **Delete** (they do it, not us), per `docs/product/ACCOUNT_DELETION.md`:
   - Whole household: the **only** parent uses Settings → Privacy & data → Delete Account, and chooses the household. They confirm with their password and the household name. This deletes every member, all household data, photos, tablets, invitations, calendar links and beta counts.
   - If there are two parents, the household can't be deleted while both exist (409 `OTHER_PARENTS_EXIST`). Each parent deletes their own account; the last one then deletes the household.
   - A teen or child can delete only their own account, from the user menu (avatar) → Delete my account.
4. **Stop counting**: if they keep using the app but leave the beta, they turn off "Share beta usage counts". That deletes their counts at once.
5. **Remove support access**: remove them from any beta chat or mailing group; ask them to unpair any tablet you lent (Settings → Devices), or collect the device; delete any export or file they sent you.
6. **Tell them** deleted data stays in server backups until rotated out (up to about 35 days), then is gone.
7. **Private cohort map**: record the exit choice and date. Delete their contact details once the beta decision is recorded and no follow-up is planned; keep only the cohort ID row with dates.
8. **Never delete for them.** Deleting a real account or household from the operator side needs Cameron's explicit approval and is not a normal beta step.
