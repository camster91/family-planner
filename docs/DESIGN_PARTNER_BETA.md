# Five-Household Design-Partner Beta

**Owner:** Cameron Ashley  
**Status:** Preparation only; recruitment and production onboarding require a
separate explicit approval.  
**Duration:** Four complete Monday-Sunday weeks after all five households have
activated.

## Purpose and boundaries

Prove that independent families can repeatedly complete Family Planner's core
loop before calendar integrations, billing, or broad market claims are added.
The beta is free. It is limited to five non-owner households, and it excludes
families that cannot provide adult consent for participating children.

The core loop is:

`parent creates family -> invites member -> plans week -> assigns chore -> child
completes -> parent verifies -> child claims reward`

## Entry gate

Do not invite a household until the exact beta candidate has all required PR
checks green and the release record contains its commit, immutable image digest,
backup, restore rehearsal, rollback proof, and explicit production approval.
Transactional email health must be green with a verified sender; log mode is not
acceptable for beta accounts.

Each participating household must have:

- one adult owner and at least one invited child or teen;
- acknowledged beta expectations and the privacy policy;
- an agreed support contact and permission to contact the adult about usage;
- no production data imported from an older app without a separately approved
  export, identity map, dry run, and reconciliation.

## Cohort register

Keep names and contact details outside product telemetry. The operational cohort
register may contain contact information but must be access-controlled. Use the
following identifiers in scorecards:

| Slot | Cohort ID | Adult consent | Activated at | Week 1 | Week 2 | Week 3 | Week 4 | Exit interview |
| ---- | --------- | ------------- | ------------ | ------ | ------ | ------ | ------ | -------------- |
| 1    | `beta-01` | Pending       | —            | —      | —      | —      | —      | —              |
| 2    | `beta-02` | Pending       | —            | —      | —      | —      | —      | —              |
| 3    | `beta-03` | Pending       | —            | —      | —      | —      | —      | —              |
| 4    | `beta-04` | Pending       | —            | —      | —      | —      | —      | —              |
| 5    | `beta-05` | Pending       | —            | —      | —      | —      | —      | —              |

## Measurement contract

Product measurement may store only a family identifier, role, event name,
success/failure, and timestamp. It must never include names, email addresses,
message text, chore photos or descriptions, medical data, locations, financial
descriptions, passwords, or tokens.

| Measure                     | Definition                                                                                  | Beta threshold                        |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| Activation                  | Family created, invited member joined, and first chore assigned                             | 5 of 5 households                     |
| Time to first value         | Registration to first assigned chore                                                        | Median <=10 minutes                   |
| Weekly core-loop completion | At least one assign, complete, verify, and reward-claim sequence in the same household/week | At least 3 of 5 in each of four weeks |
| Core mutation reliability   | Successful valid core mutations / all valid core mutation attempts                          | >=99%                                 |
| Isolation                   | Any confirmed cross-family read or write                                                    | Zero; immediate stop if non-zero      |
| Willingness to pay          | Adult independently says they would pay for continued use before a price is suggested       | At least 3 of 5 before billing work   |

Record support incidents separately with severity, affected cohort ID, first
observed time, resolution time, and linked issue. Do not paste private household
content into issues.

Generate the privacy-safe database scorecard with:

```bash
BETA_START_DATE=2026-09-07 \
BETA_COHORTS='{"beta-01":"family-id-1","beta-02":"family-id-2","beta-03":"family-id-3","beta-04":"family-id-4","beta-05":"family-id-5"}' \
npm run beta:scorecard
```

The command intentionally reports mutation reliability as unavailable until
valid-attempt telemetry is implemented. That missing value is a beta entry-gate
failure, not zero and not an invitation to estimate the result.

## Weekly operating cadence

1. Monday: verify health, email delivery, backup freshness, and rollback digest.
2. Midweek: review aggregate scorecard and unresolved incidents; do not coach a
   household into completing a metric merely to improve the score.
3. Friday: ask the adult one neutral question: “What was hardest to coordinate
   in Family Planner this week?”
4. Sunday: freeze the weekly scorecard, calculate thresholds, and record product
   decisions separately from raw feedback.

## Stop conditions

Pause onboarding and notify affected adults if any of these occurs:

- cross-family access, exposed authentication data, or unauthorized child
  registration;
- unrecoverable data loss, failed backup restoration, or rollback failure;
- repeated transactional-email failure that blocks verification or recovery;
- a P0/P1 incident without an identified containment and owner.

Production data deletion, family deletion, or rollback remains an explicit
operator action. Do not use beta participation as standing approval for those
actions.

## Exit and decision

At four weeks, export the aggregate scorecard, conduct five adult exit
interviews, and choose one of: extend the free beta, fix and repeat, or validate
the `$39-$49/year` annual-plan hypothesis. Calendar integrations and billing
remain out of scope until the thresholds above are met and documented.
