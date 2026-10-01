# Beta Support

How the owner handles a support request during the design-partner beta (about five households). Issue #146.

This runbook is for people. It adds no code path that lets an operator read or change a family's data. The beta
rules in `docs/product/BETA_OPERATIONS.md` ("Support", "Incidents", "Offboarding and data deletion") still apply.

## Where requests come from

- **Support email:** `<SUPPORT_EMAIL>` (placeholder; the owner fills it in). It is set in one place in the app,
  `src/lib/support.ts` (`SUPPORT_EMAIL`). While it is empty, the Help page shows "Support email coming soon" and
  tells people to contact whoever invited them. Fill in both together (`docs/LAUNCH_CHECKLIST.md` item 5).
- **In-app Help page:** `/dashboard/help` (parents, user menu → Help). It answers the common questions below, so
  point people there first.
- Direct messages to the owner from beta adults also count. Log them the same way.

## Response times (five-household beta)

| Kind of request                 | Examples                                                                                       | First reply              | Fix or answer                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| Privacy or child safety         | "I can see another family's things", a stranger in our household, a worry about a child's data | Within 1 hour when awake | Follow "Privacy or child-safety concern" below right away |
| Can't use the app               | Can't sign in, no verification or reset email, app won't load                                  | Within 4 hours           | Same day if possible                                      |
| Data request                    | Export help, delete my account or household                                                    | Within 1 working day     | Within 3 working days                                     |
| Bug with a workaround, question | "How do I…", a broken feature, odd wording                                                     | Within 1 working day     | Weekly triage                                             |

Check the inbox at least once a day while the beta runs (`docs/product/BETA_OPERATIONS.md`, "Cadence").

## Rules for every request

- Refer to households only as `beta-0N` in notes and GitHub. Never copy names, child names, messages, photos,
  addresses or screenshots with personal data into GitHub.
- Do not sign in as a family member and do not join a beta household.
- Do not change or delete a live account or household yourself. That needs Cameron's explicit approval for that
  exact action (`AGENTS.md`, "Approval boundaries"). People fix their own accounts with the in-app steps below.
- Reply in plain words. Say what to do next and when you will get back to them.

## Locked out: the verification email did not arrive

A new adult cannot sign in until they confirm their email.

1. Ask them to check spam or junk, and to wait a few minutes.
2. Ask them to try to sign in. The sign-in page offers "Resend verification". Only the newest link works. Links
   last 24 hours.
3. If many tries fail, they may have hit the limit (six an hour). Ask them to wait an hour.
4. Still nothing: check Mailgun (Sending → Logs, then Suppressions) for their address. Follow
   [TRANSACTIONAL_EMAIL.md "When it breaks"](TRANSACTIONAL_EMAIL.md#when-it-breaks). If the address is on the
   suppression list, remove it only after they confirm the address works.
5. If no one at all is getting emails, treat it as SEV1 (see "Incidents" in `docs/product/BETA_OPERATIONS.md`).

## Password reset

1. Send them to "Forgot password" (`/forgot-password`, also linked from the sign-in page and the Help page).
2. The reset link lasts 1 hour. Resetting signs them out on every device, which is expected.
3. If the reset email does not arrive, follow steps 1, 3 and 4 of the section above.
4. You cannot set a password for them. Do not try to.

## Data export or deletion request

People do this themselves. Walk them through it; do not do it for them.

- **Export:** Settings → Privacy & Security → Data Export. Each member downloads their own copy. A teen or child
  asks a parent, or uses "Download my data" inside their delete dialog.
- **Delete:** follow `docs/product/ACCOUNT_DELETION.md` and "Offboarding and data deletion" in
  `docs/product/BETA_OPERATIONS.md`. In short: the only parent can delete the whole household from Settings →
  Privacy & Security → Delete Account. With two parents, each deletes their own account and the last one deletes
  the household. A teen or child uses user menu → Delete my account.
- **Tell them about backups:** deleted data stays in server backups until they rotate out, up to about five weeks
  ([BACKUPS.md "Retention"](BACKUPS.md#retention)). Do not restore a backup to "undo" a deletion without
  Cameron's approval.
- If they send you an export or file, delete it once the request is done.
- Record the request type and date (not the content) against their cohort ID.

## Bug report intake

1. Thank them. Ask for: what they tried, what they expected, what happened, the page, the device (phone, tablet,
   computer) and the rough time.
2. Ask them to describe it in words. Do not ask for screenshots of family content. If they send one, do not copy it
   anywhere and delete it when done.
3. Check the server logs for that time (`docker logs`, 5xx answers on that route).
4. Give it a severity using the table in `docs/product/BETA_OPERATIONS.md` ("Incidents").
5. Open a GitHub issue with no personal data: `beta-0N`, date, severity, area, steps, expected and actual result.
6. Reply with what happens next. Tell them when it is fixed.

## Privacy or child-safety concern

Examples: someone sees another family's information; an unknown person is in their household; a child's account
was created without a parent; a worry about what a child can see.

1. Reply within one hour when awake. Ask them to stop using the affected part and not to share screenshots
   publicly.
2. **Another family's data, or account takeover:** this is SEV0. Follow the stop condition in
   `docs/product/BETA_OPERATIONS.md` ("Incidents") and
   [INCIDENT_RESPONSE.md "Cross-household exposure"](INCIDENT_RESPONSE.md#cross-household-exposure). Tell Cameron at
   once.
3. **Unknown member in the household:** ask a parent to (a) remove them on the Family tab (the remove button on
   their row, "Remove from household"; this signs them out everywhere and cuts their access), (b) get a new family
   code (Family → Add Member → "In person instead" → "Get a new family code"; the old code stops working at once),
   (c) cancel any pending invites on the same page, and (d) change their password if someone else may know it.
   Recent changes in Settings shows who joined and who removed whom. Tell Cameron at once: treat it as a possible
   account takeover (SEV0) until you know how they got in. Agents and support never remove a member from the
   operator side; that needs Cameron's explicit approval. Rules (decision O-34): only a parent can remove, never
   themselves and never the last parent.
4. **Child account without parental consent:** follow the privacy page ("Children's data"). Removing it is done by
   the parent in the app, or by Cameron with explicit approval.
5. **Lost or stolen fridge tablet:** a parent removes it in Settings → Devices. See
   [INCIDENT_RESPONSE.md "Lost/stolen shared device"](INCIDENT_RESPONSE.md#loststolen-shared-device).
6. Record it as an incident (`beta-0N`, date, severity, area). No private content.
7. Any message to all beta families is sent by the owner, not by an agent.

## Related

- `docs/product/BETA_OPERATIONS.md` — beta rules, severities, offboarding
- [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md) — email settings and what to check when email fails
- [BACKUPS.md](BACKUPS.md) — backups, retention and restore
- [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) — incident loop
- `docs/product/ACCOUNT_DELETION.md` — how deletion works
