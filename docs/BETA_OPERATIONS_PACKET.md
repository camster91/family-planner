# Design-Partner Beta Operations Packet

**Owner:** Cameron Ashley  
**Status:** Reusable preparation only. It does not authorize recruitment,
contact, onboarding, production access, or collection of personal information.

Use this packet with the [five-household beta plan](DESIGN_PARTNER_BETA.md).
Store contact details, signed acknowledgements, and raw interview notes in an
approved access-controlled system outside the repository and product telemetry.

## Household entry record

Create one private record per household. The repository-facing register uses
only its assigned `beta-01` through `beta-05` cohort ID.

- Cohort ID:
- Adult participant and approved contact channel:
- Adult authority to participate and involve the child or teen confirmed:
- Beta purpose, four-week duration, free status, and experimental nature
  acknowledged:
- Privacy policy and account-deletion controls reviewed:
- Permission to contact the adult about product use recorded:
- Child or teen name excluded from research artifacts:
- Support route and expected response window acknowledged:
- Exact production candidate and onboarding date:
- Separately approved legacy import required: yes / no
- Entry-gate operator and timestamp:

Do not treat this checklist as legal advice or as a substitute for an approved
consent notice. Pause onboarding if the adult's authority or acknowledgement is
unclear.

## Entry-gate checklist

The operator records evidence, not just a pass/fail assertion:

- All required checks are green for the exact candidate SHA.
- Immutable production image digest matches the reviewed candidate.
- Backup freshness, isolated restore, and retained rollback digest are proven.
- Transactional-email health is green and verification and recovery messages
  were delivered to the approved acceptance inbox.
- Production promotion received exact-artifact approval.
- Privacy policy, export, and account-deletion journeys are reachable.
- No open P0 or P1 incident affects onboarding.
- Cohort ID maps to one unique production family ID in the private register.
- Adult acknowledgement is complete.
- Any legacy import has its own approved export, identity map, dry run, and
  reconciliation record.

## Support and incident log

Use one row per incident. Never copy message text, photos, medical information,
addresses, financial descriptions, passwords, tokens, or personal contact data
into this log.

| Incident ID    | Cohort ID | Severity          | First observed UTC | Contained UTC | Resolved UTC | Product area | Issue link | Status |
| -------------- | --------- | ----------------- | ------------------ | ------------- | ------------ | ------------ | ---------- | ------ |
| `beta-inc-001` | `beta-01` | P0 / P1 / P2 / P3 | —                  | —             | —            | —            | —          | Open   |

Severity and response rules:

- **P0:** cross-family access, exposed authentication material, or unrecoverable
  data loss. Stop the beta immediately and contain before further diagnosis.
- **P1:** core loop unavailable, verification/recovery broadly failing, or
  backup/rollback proof invalid. Pause affected onboarding immediately.
- **P2:** important workflow impaired with a safe workaround. Acknowledge within
  one business day and assign an owner.
- **P3:** cosmetic or low-impact friction. Record for weekly prioritization.

Only the authorized incident owner contacts participants. Security or privacy
incidents follow the applicable response and notification obligations; this
packet does not determine those obligations.

## Weekly evidence record

Freeze one privacy-safe record after each complete Monday-Sunday beta week:

- Week number and UTC date range:
- Exact deployed SHA and image digest:
- Health and transactional-email result:
- Latest successful backup and isolated-restore proof:
- Aggregate scorecard filename and generation timestamp:
- Activation count:
- Median time to first value and observation count:
- Ordered role-aware core-loop households:
- Mutation attempts, successes, and reliability:
- Isolation incidents: zero / stop condition invoked
- Open incidents by severity:
- Neutral weekly question asked to each available adult:
  “What was hardest to coordinate in Family Planner this week?”
- Product decisions linked separately from raw feedback:

Recommended privacy-safe artifact name:
`beta-week-<1-4>-scorecard-<YYYY-MM-DD>.json`. Keep raw database identifiers out
of documents, issues, and screenshots shared beyond the authorized operator.

## Exit interview guide

Ask the same core questions before suggesting features or prices:

1. What did your household use Family Planner to coordinate?
2. Walk me through the last time the chore-to-reward loop worked well.
3. Where did the process break down or require help?
4. What, if anything, replaced another tool or family habit?
5. What would make you stop using it?
6. Would you want to continue using it after this beta? Why?
7. Without showing a price: would you personally pay for continued use?

Record willingness to pay as **yes**, **no**, or **unclear** only when the adult
answers independently before a price is suggested. Do not infer it from praise,
usage, or willingness to continue for free.

## Household exit and deletion

- Confirm whether the adult wants to continue, export, or delete the account.
- Treat export and deletion as explicit account-owner actions; beta consent is
  not standing deletion authority.
- Provide the in-product export before deletion when requested.
- Confirm deletion through the product flow and record only cohort ID, operator,
  timestamp, and outcome.
- Remove the family ID mapping and personal contact record according to the
  approved retention policy.
- Revoke any temporary support access.
- Record the aggregate exit decision: extend free beta, fix and repeat, or begin
  pricing validation.

Calendar integrations and billing remain gated until the four-week thresholds
and all five interviews are complete.
