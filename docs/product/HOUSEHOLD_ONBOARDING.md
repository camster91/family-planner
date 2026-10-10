# Household onboarding — Cameron correction, 2026-10-09

Related: #132, #446. This is the implementation specification; it does not claim deployment.

Creating a family must immediately prompt adding everyone. Dashboard onboarding must not refresh out of the third step. Both creation entry points lead to member setup. Parents can finish later and return through Family → Add Member. Creation failures retain the draft; pending creation must not repeat.

## Children without email or a personal device

A parent can add a child by name. No email address, password, fake address, verification email or personal device is required. The child is a canonical household member, assignable on chores and present in the existing shared tablet member picker. This must use the existing User membership model, not a second roster. Name-only members have no personal authenticated session. Email/account invitations remain an optional separate path for household members with their own login.

The fridge tablet continues to use its existing paired-device session, scope and opt-in write policy. Selecting a child for allowed shared chores does not sign into a parent's account, elevate permissions or reveal parent data. A three-year-old does not need to operate a parent's private phone session.

## Required next implementation gates

- Expand User.email to nullable while preserving unique non-null addresses; password already nullable. Rehearse an idempotent non-destructive migration and old-client null handling.
- Parent-only canonical member creation, server-derived family, trimmed bounded name, fixed child role, no client-supplied household/access/email/password. Re-check parent membership under the existing user/household locks.
- Stable request identity for retries; success must not create duplicate members on uncertain reply. No global uniqueness on children's names.
- Explicit no-email child form in member setup, list added members and allow adding the next person. Keep household draft on failure. Distinguish added members from pending email invitations.
- Prevent all credential issuance and recovery routes from authenticating name-only members; preserve role, two-household and paired-device isolation.
- Audit notification/export/member/removal consumers for nullable email; skip mail without an address. Existing deletion and shared member ownership remain canonical.
- Focused parent/child/teen/anonymous/paired-device API negatives, two-family injection, retries, multiple equal-name children and real PostgreSQL migration coverage.
- Rendered phone/portrait/fridge setup and actual shared-tablet child selection proof before claiming the journey works. No new parent elevation or tablet-write enablement.

## Current evidence

The bounded prompt repair is implemented locally with four affected component tests, typecheck and scoped lint passing. No source build, rendered candidate, migration, managed-child creation or deployment acceptance is claimed. Local disk capacity blocks a safe isolated build/dependency preparation; preserve existing app builds and unrelated work.
