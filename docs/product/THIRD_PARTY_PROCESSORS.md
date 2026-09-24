# Third-Party Processor Register

Do not treat a roadmap candidate as an active production processor. Add/update an entry only when the integration is actually selected/configured.

| Provider | Purpose | Status | Data sent | Credentials | Failure/disable path | Privacy/security review |
|---|---|---|---|---|---|---|
| PostgreSQL hosting / current infrastructure | Core app data storage | Verify current production provider before public release | household application data | server-side | backup/restore/migration runbooks | required |
| VPS/Docker hosting | application deployment/hosting | existing production host; provider and region require owner verification | application runtime/operational data | server-side | rollback runbook | required |
| AI provider | contextual assistance | not committed by roadmap | task-minimized authorized context only | server-side | feature kill switch/manual workflows | required before prod |
| Calendar provider | optional sync | not committed | authorized event/sync fields | server-side OAuth/token storage | disconnect/disable adapter | required before prod |
| Weather provider | optional dashboard weather | not committed | coarse configured location if needed | server-side where possible | omit weather card | required before prod |
| Notification provider | push/email delivery | existing/future provider must be reconciled | purpose-limited delivery metadata | server-side | provider isolation/in-app fallback | required |
| Analytics/crash provider | product/reliability telemetry | reconcile actual dependencies/config | privacy-safe event/technical metadata | config-dependent | disable SDK/collection | required |

## Entry requirements
Record:
- exact service/product;
- why it is necessary;
- data categories and whether children/teens/shared devices are involved;
- data regions/retention settings where relevant;
- authentication/credential owner;
- current cost/plan and spend approval where applicable;
- deletion/export/revoke capability;
- outage/fallback behaviour;
- privacy/security documentation review date.

## Rule
No agent may enable a new paid/production processor or credentials based only on this table. Selection, spend, credentials and production rollout retain explicit approval gates.