# Open Issue Triage

Snapshot reviewed: 2026-08-28. GitHub reported 13 open issues.

| Issue | Priority | Current evidence | Disposition |
| --- | --- | --- | --- |
| #85 release validation | P0 | Release checks previously suppressed failures | Active umbrella; Wave 0 |
| #84 reliable release plan | P0 | Existing shipping plan remains directionally correct | Expanded by consolidation plan |
| #60 recurring chore serial awaits | P1 | `expandAllRecurringChores` awaited each expansion serially | Fixed locally; verify tests/review |
| #58 migration failure swallowed | P0 | entrypoint continued after migration error | Fixed locally; verify container test |
| #57 CI checks non-blocking | P0 | multiple workflows used `continue-on-error` | Fixed locally; verify GitHub run |
| #56 tracked `.env.production` | P0 | template was tracked at production filename | Replaced locally with ignored template; audit history still required |
| #55 strict TypeScript overridden | P0 | `noImplicitAny` was false | Fixed locally; strict build passes |
| #54 settings labels | P1 | profile inputs and language select were unlabeled | Fixed locally; accessibility run required |
| #53 duplicate settings labels | P1 | duplicates #54 | Close as duplicate after #54 verification |
| #37 invalid handoff datetime | P1 | POST/PATCH now reject invalid dates with 400 | Code-fixed upstream; E2E verification required |
| #36 teen wishlist detail | P1 | current UI has no detail route; family API allows teen reads | Superseded UI; role E2E required before closure |
| #34 calendar date selection | P1 | current form uses controlled native date inputs | Code-fixed upstream; browser E2E required |
| #16 partially failing CI | P0 | duplicate deploy workflows and suppressed checks found | Fixed locally; verify first remote CI run |

No issue is considered closed solely from static inspection. Each code-fixed
item requires its listed verification evidence before the GitHub issue closes.

