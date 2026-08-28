# Open Issue Triage

Snapshot reviewed: 2026-08-28. GitHub reported 13 open issues. The fixes and
consolidation foundation are collected in PR #95.

| Issue                             | Priority | Current evidence                                                                  | Disposition                                                                                  |
| --------------------------------- | -------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| #85 release validation            | P0       | Release checks previously suppressed failures                                     | Active umbrella; Wave 0                                                                      |
| #84 reliable release plan         | P0       | Existing shipping plan remains directionally correct                              | Expanded by consolidation plan                                                               |
| #60 recurring chore serial awaits | P1       | `expandAllRecurringChores` awaited each expansion serially                        | Fixed in PR #95; local suite passes                                                          |
| #58 migration failure swallowed   | P0       | entrypoint and migration runner continued after errors; image omitted feature SQL | Fixed in PR #95; container run blocked by unavailable local Docker and GitHub runner billing |
| #57 CI checks non-blocking        | P0       | multiple workflows used `continue-on-error`                                       | Fixed in PR #95; Actions re-enabled, runner start blocked by account billing                 |
| #56 tracked `.env.production`     | P0       | template was tracked at production filename                                       | Fixed in PR #95; history audit found no real secret in the removed template                  |
| #55 strict TypeScript overridden  | P0       | `noImplicitAny` was false                                                         | Fixed in PR #95; strict build passes                                                         |
| #54 settings labels               | P1       | profile inputs and language select were unlabeled                                 | Fixed in PR #95; automated browser accessibility run remains required before release         |
| #53 duplicate settings labels     | P1       | duplicates #54                                                                    | Close as duplicate when #54 merges                                                           |
| #37 invalid handoff datetime      | P1       | POST/PATCH now reject invalid dates with 400                                      | Code-fixed upstream; E2E verification required                                               |
| #36 teen wishlist detail          | P1       | current UI has no detail route; family API allows teen reads                      | Superseded UI; role E2E required before closure                                              |
| #34 calendar date selection       | P1       | current form uses controlled native date inputs                                   | Code-fixed upstream; browser E2E required                                                    |
| #16 partially failing CI          | P0       | duplicate deploy workflows and suppressed checks found                            | Workflow fixed and Actions enabled; account billing currently prevents runners from starting |

No issue is considered closed solely from static inspection. Each code-fixed
item requires its listed verification evidence before the GitHub issue closes.

## Remaining owners and acceptance criteria

- Repository owner: restore GitHub Actions billing or raise the spending limit.
  Acceptance: CI Build starts a hosted runner and every step passes on PR #95.
- Release owner: provide staging `DATABASE_URL`, backup, and Docker runtime.
  Acceptance: migrations apply from the current production schema, the container
  health check passes, and rollback restores the pre-migration backup.
- Product QA owner: verify #34, #36, #37, and #54 with parent and teen test users.
  Acceptance: calendar date selection persists, wishlist navigation never opens
  a missing detail route, invalid handoff dates return inline 400 feedback, and
  every settings field has an accessible name.
- Data owner: export production ChoreChamps and Budget App databases and approve
  identity maps. Acceptance: dry-run skipped counts are reviewed, persisted
  counts reconcile by source model, and no source app is archived before the
  rollback window ends.
