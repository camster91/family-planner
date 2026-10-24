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

- **Export:** Settings → Privacy & data → Data Export. Each member downloads their own copy. A teen or child
  asks a parent, or uses "Download my data" inside their delete dialog.
- **Delete:** follow `docs/product/ACCOUNT_DELETION.md` and "Offboarding and data deletion" in
  `docs/product/BETA_OPERATIONS.md`. In short: the only parent can delete the whole household from Settings →
  Privacy & data → Delete Account. With two parents, each deletes their own account and the last one deletes
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

## Twenty anticipated support cases — #146

This is a source-backed triage guide, not proof that a feature is enabled or a
recovery journey has passed. Feature availability, role rules and current
release configuration still apply. Never ask for passwords, tokens, invite/link
codes, API keys, exports, private screenshots or household record contents.
Use a case ID, approximate time, route template, public release/build identity,
platform and a content-free description. Ask the adult/account owner to use
canonical self-service actions; support must not impersonate them.

| # | Problem | Safe first action | Escalation / boundary |
| --- | --- | --- | --- |
| 1 | Verification email did not arrive | Account owner checks spam and requests a fresh verification link; use the newest link | Record time and whether any message arrived, not address/token in GitHub. Widespread failure is SEV1; sending config belongs to #103 |
| 2 | Password reset failed or expired | Request one fresh reset link and use the account owner's normal sign-in path | Never collect a password/reset link. Repeated or widespread failures go to the owner; do not reset an account from support |
| 3 | Wrong account or sign-in confusion | Ask the person to confirm which account they intended to use, privately, through the app | Do not infer ownership from a name/email match or reveal whether another account exists; suspected takeover is SEV0 |
| 4 | Invite expired or wrong household | A signed-in parent reviews pending invitations and explicitly revokes/reissues the intended invite | Do not paste invite codes or join a household to inspect it. An unknown member follows privacy incident handling |
| 5 | Young family member has no email | Use name-only setup only when its current capability/gates are available | Never invent an email, password or User; unavailable profile setup is a capability issue under #480 |
| 6 | Profile account link failed | Refresh the canonical profile-link review; check current same-household/role and verified-owner requirements | Revoke only unfinished links. Do not merge people or treat revoke/removal as standalone unlink; use #557 contract |
| 7 | Google/Apple calendar not showing | Open Calendar connections and inspect the selected source/subscription state | Read-only subscription is distinct from provider write sync. Never ask for calendar credentials, secret feed URLs or OAuth tokens |
| 8 | Duplicate or missing calendar event | Check viewed range/timezone/source filters and whether the event is local or connected | Do not delete repeated imports or edit provider records from support; preserve content-free source/range/request evidence for #124 |
| 9 | Weekly chore is on the wrong day | Parent reviews chosen weekdays/start or monthly anchor in the canonical chore editor | Preserve occurrence history; do not bulk-delete a series to hide a recurrence problem; #450 owns schedule semantics |
| 10 | Routine order/steps do not match | Parent opens the existing dated/future routine editor and reviews the exact affected scope | Do not substitute a label for stable routine/step identity. Preserve unknown-save request/recovery state |
| 11 | Completed chore still waits for approval | Explain the existing parent-review state and direct the parent to the canonical review action | A child's completion is not parent approval. Do not approve on behalf of a parent or promise points before canonical verification |
| 12 | Points or reward balance looks wrong | Review the app's own earned/claimed/approved states with the account owner | Never grant points, transfer awards or change a balance from support; a credit/Undo mismatch is a data-integrity case |
| 13 | Groceries shortcut or count is confusing | Open the direct grocery destination; distinguish all shared lists from grocery lists and preview rows from total | Do not say clear from a short loaded preview. Pending tick/Undo and remaining items need canonical refresh/recovery |
| 14 | Offline change is stuck or save is uncertain | Keep the original pending work; use the visible sync/recovery path after reconnect | Do not clear browser/app data, re-enter the operation with a new key or copy work to another account; escalate uncertain authority to #135/#564/#565 |
| 15 | Recipe search/import failed | Keep the reviewed source attribution, try manual entry or another supported public source | Do not embed arbitrary publisher HTML or ask for private-page credentials. Provider failure must not block manual recipes |
| 16 | Bulk-cooking portions/next prep looks wrong | Open the canonical prep session/dish and review recorded portion use and dates | Do not infer eaten quantities, nutrition or food safety. Preserve unknown operations and use supported correction/Undo |
| 17 | Shared tablet lost, revoked or stuck | Parent uses the existing personal device revoke/re-pair flow | Profile selection/wake voice never proves a parent identity. Support does not pair/elevate/provision a device on the operator side |
| 18 | Child/teen sees unexpected controls or another household | Stop using the affected path and report content-free route/release/request evidence | Cross-household exposure/takeover is SEV0; follow immediate stop/containment. Do not request private screenshots or broaden access to investigate |
| 19 | Export or deletion is unclear | Direct the account owner to the existing private export/account/household deletion flow below | Explain last-parent and backup-retention boundaries; do not restore erased identity or perform operator deletion without exact authorization |
| 20 | Notification missing, snoozed or too noisy | Check in-app unread/snoozed state, personal preferences and quiet hours | In-app state is distinct from actual email/push delivery. No provider/scheduler is activated by support; preserve snooze/Show now and disabled-provider behavior |

## Response ownership

| Responsibility | Owner and authority |
| --- | --- |
| Beta incident commander, severity/stop decision and response coordination | Cameron; use the established severity/containment runbook, not ad hoc access to household content |
| First-line private support intake and case tracking | Cameron or a specifically designated support operator; no delegation/access is created by this document |
| Source diagnosis, isolated repair and recovery/communication drafts | Codex; live account/provider/infrastructure actions and sending remain subject to existing exact authorization |
| Canonical personal/household actions | The authenticated account owner/parent in the app; support cannot substitute for owner verification |
| Production containment, credential/device changes, restore and rollout | The explicitly authorized operator; follow INCIDENT_RESPONSE.md and the relevant runbook, recording exact scope and evidence |
| External/user communication, including privacy incidents | Cameron approves the content, audience and sending decision; agents prepare drafts only |

Severity examples and the immediate cross-household stop/containment sequence
remain in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). No incident, support
outreach, production containment, account recovery or device operation was run
while preparing this guide. Public communication strategy, dedicated-support
scaling thresholds, operator dashboards and actual recovery evidence remain
separate unfinished #146 criteria.
