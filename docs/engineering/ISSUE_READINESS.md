# Agent-Ready Issue Criteria

An issue is ready for autonomous implementation when all applicable fields below are clear enough that the agent does not need to invent product behaviour.

## Required
- One outcome achievable in a reviewable PR.
- Parent/related issues and dependencies linked.
- Explicit in-scope and out-of-scope boundaries.
- Existing canonical source/models/components identified or a decision issue linked.
- Acceptance criteria are observable.
- Verification expectations listed.
- Approval boundaries called out when external/destructive actions could follow.

## UI issues additionally need
- Figma/spec/reference or permission to produce the design artifact first;
- target surfaces/breakpoints;
- required data states;
- accessibility expectations;
- shared-device/privacy implications;
- original graphic/asset requirements if any.

## Data/API issues additionally need
- household ownership/roles;
- request/response/error contract;
- migration/old-client compatibility;
- idempotency/concurrency/offline policy;
- negative isolation tests.

## Android issues additionally need
- device/window/lifecycle scope;
- packaging/API compatibility implications;
- permission/back/deep-link behaviour where relevant.

## Not ready when
- canonical models are still disputed;
- a required Figma/product decision is missing;
- acceptance says only “make it better”;
- issue combines several phases/domains that should be separate;
- production credentials/data are required but approval is missing.

## Agent response to unready work
Do safe source inspection/planning, split/clarify the issue, and stop before committing to an invented contract.