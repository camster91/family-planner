# Packaging validation and conditional subscription behavior — #110

2026-10-26. Planning definition and public-source research only. No billing code,
provider choice/setup, price publication, purchase, contact, household research,
QA or release action is authorized or performed by this document. These proposed
behaviors are a reviewable future contract, not customer terms or an adopted
commercial offer. #110 remains gated by the original beta thresholds and at
least three of five adults independently expressing willingness to pay.

## Source and demand boundary

Use `docs/product/BETA_OPERATIONS.md` for the existing free four-week beta,
neutral exit interview and private observations. Ask willingness to pay before
suggesting any price. No current willingness-to-pay observations were supplied
or collected in this pass. Do not convert feature requests, Cameron's household,
competitor prices or a completed document into customer validation. Do not
contact participants, read production scorecards or start a packaging experiment
without the original authorization. The existing $39–$49 annual family-plan
hypothesis has no confirmed currency or accepted launch price in #110.

## Official competitor observations

Public pages read2026-10-26 through the web tool; page content, not a checkout,
regional app-store quote, invoice, tax calculation or exchange-rate comparison.
Refresh again before an actual commercial decision. No prices are converted.

| Product / offer | Observed public price | Scope / useful comparison | Official source and limits |
| --- | --- | --- | --- |
| Cozi Gold | $39/year; FAQ explicitly says USD | Whole-account upgrade; its free offer includes calendar, lists and recipes | [Plan comparison](https://www.cozi.com/compare-plans/), [billing FAQ](https://www.cozi.com/faq/). This is a family organizer comparison, not proof of feature parity or demand. |
| Cozi Max | $79/year as displayed | Higher tier includes AI event import, recipe creation and meal planning | [Plan comparison](https://www.cozi.com/compare-plans/). Currency is shown as `$` on this page; do not infer a Canadian quote or equate this offer with a Gold invoice. |
| FamilyWall Premium | $4.99/month; $44.99 billed annually, as displayed | Family subscription; premium page lists meal planning, recipe box and Google/Outlook sync | [English premium page](https://www.familywall.com/premium.html?lang=en). The inspected price block does not explicitly identify USD/CAD or tax; preserve that uncertainty. Do not annualize the monthly price as its advertised annual offer. |
| AnyList Complete | US$9.99/year individual; US$14.99/year household | Focused shopping, recipe and meal-planning comparison | [Official getting-started guide](https://help.anylist.com/articles/getting-started/), [Complete overview](https://www.anylist.com/complete). Not a full household calendar/chores product-equivalence claim. |

Inference: the observed annual offers span different bundles and prices. They
are reference points for a later neutral packaging study, not evidence that
Herewoven should match a tier, charge in USD, sell AI separately or can support
unlimited provider usage. No store policy, provider eligibility, margin or tax
conclusion is inferred from a public price.

## Packaging study definition, not an executed experiment

After the original beta threshold is evidenced, compare one annual household
upgrade with a useful core free experience. Use the same neutral feature cards
and explicit currency/tax assumptions for every adult. Keep current verified
capabilities separate from proposed/native/provider-dependent capabilities; do
not promise unshipped work. Record aggregate preferred package, independently
stated price/value, objections and a go/revise/stop recommendation without
names, household content or child answers. Retain the private raw observations
outside issues/git under the beta's existing consent and retention process.

Free core proposal: household participation, existing manual planning/chores/
lists, access to one's stored content, export/deletion/security and permission
controls stay available. Optional paid proposals may cover extra convenience or
metered assistance only after cost/provider eligibility is resolved in #567.
Do not retroactively remove existing free data or add a paywall in this pass.
Feature-by-feature final packaging, quotas, currency and price require Cameron's
commercial decision; this document supplies no entitlement implementation.

## Conditional lifecycle definition

These defaults define a proposed first paid version for review. They do not
replace the currently free beta or legal/operator decisions in #372.

| Area | Proposed behavior | Required review/input before implementation or publication |
| --- | --- | --- |
| Trial | A separate14-day no-card paid-feature trial after any commercial launch. One eligibility decision per original household; membership changes/reinstalls do not create a new trial. Expiry returns to free without a charge. The beta remains its separately agreed free four weeks. | Approve trial length, original-household eligibility/recovery, abuse policy and exact feature limits. Do not invent email-free child accounts to obtain trials. |
| Purchase and renewal | One explicit adult checkout accepts the exact currency, annual amount, tax basis, renewal date and recurring nature. Renewal remains opt-in through that checkout; no card capture or automatic conversion from beta/no-card trial. Use authoritative provider periods and server time. | Owner accepts final offer and channel/provider rules. No current amount/currency is selected; absent required price/tax/terms blocks sale. |
| Cancellation | Verified payer can stop the next renewal through the original purchase channel. Keep already paid benefits through verified paid-until; show pending until provider cancellation is confirmed. Give a recoverable reference after success. Cancellation alone neither deletes family data nor removes members. | Define channel-specific management link, authentication and outage/reconciliation evidence. An unknown result must not say canceled or submit a new subscription. |
| Refund | Proposal: adult may request review within14 days of the first annual purchase. No automatic prorating/renewal refund promise in product copy. A confirmed refund updates paid entitlement once, with a clear effective date; disputed/partial outcomes await reconciliation. | Cameron and the selected operator/channel must approve the actual offer, required remedies, review process and wording before it becomes customer policy. No legal entitlement or store refund authority is asserted here. |
| Tax | Display explicit currency and reviewed tax-inclusive or tax-added basis before commitment; retain minimal correct receipt fields through the approved provider. Never infer residence, tax rate, exemption or merchant status from household language/timezone. Unresolved calculation/merchant/jurisdiction inputs block charging. | Operator/merchant jurisdiction, supported markets, tax handling, receipt identity, accounting and retention review. No tax rates or legal obligations are selected by this plan. |
| Failed payment | Proposal: up to seven days of grace after a previously verified paid period, with one clear parent/payer notice and an update-payment route. Then fall back to free; preserve stored content and export/deletion. Do not erase routines, punish children, create negative points or repeatedly notify the household. Provider retry cadence needs its own approved setup; no custom scheduler is proposed. | Approve grace duration, provider retry/notice ownership, outage behavior and recovery. An unverified payment state does not grant a fresh paid period or create repeated charges. |
| Entitlement | One server-owned household entitlement supplies all authorized family surfaces. States: free, trial-active, paid-active, grace, free-after-expiry; pending/unknown reconciliation never fabricates a paid-until. Honor an existing verified period while valid; after expiry allow core free access while reconciling. Premium/AI access never overrides role, feature, paired-device, provider or budget gates. | Canonical provider-independent storage/receipt design, exact idempotency, original household/birth binding and metering limits. No billing table/queue/provider code is added now. |
| Owner | Adult payer authority is separate from household admin/member identity. Parent promotion, joining a family, account linking, shared-tablet access or a known email does not transfer a payment method. Review and confirm a transfer with both authorized adults; no child/teen billing UI or payment data on fridge surfaces. | Decide payer recovery and household-change rules with #480/#557/#136. Transferring household administration alone never changes a provider customer/subscription. |
| Deletion | Cancellation, account deletion and household deletion remain distinct. Export/erasure and the existing account/profile contract remain available without paying. Household deletion must request termination of future renewal and retain truthful pending/unknown provider state until reconciled. Account deletion must not silently delete the rest of the household or transfer billing authority. | Resolve original household/payer identity, provider cancellation failure, multi-parent handoff and legal/operator receipt retention before implementation. Keep only separately approved necessary receipt/provenance fields; no invented retention period or child content in financial records. Existing #557 deletion/link policy remains unresolved by this proposal. |

During downgrade keep user-authored data intact and distinguish read/export from
creating new premium operations. Any quota affects only its reviewed operation;
never hide basic family membership, privacy controls, existing content or a
pending recovery command to force payment. Provider/AI unavailability should
retain the canonical manual workflow; it must not silently spend on another
provider, invent unlimited allowances or broaden retrieval of private records.

## Future implementation boundary and recovery contract

Only after #110's demand/decision/approval gates pass should a separate reviewed
implementation add canonical billing records and channel adapters. One original
household and verified adult payer own each deliberate purchase command. Keep
stable provider IDs and validated entitlement versions; do not infer paid state
from a browser redirect, local preference, feature toggle or unverified webhook.
No card data, provider secret, child profile details or household content belong
in client bundles, support issues or billing telemetry.

Provider event application must authenticate the source, deduplicate original
event/receipt IDs transactionally, reject wrong household/birth associations,
handle out-of-order/replayed events and reconcile ambiguous outcomes against
canonical state. Inspect/retry the original command rather than creating another
purchase after a timeout. A charge, refund, cancellation, restore and entitlement
are distinct outcomes; confirming one must not guess the others.

Restore purchases must prove the original channel account and intended original
household without merging household identities or moving entitlement based on
email/display name. Old clients retain free/core behavior; unsupported premium
writes fail clearly without replaying a new charge. Approval must name the
supported native/web channels and old-client/server window (#473/#138/#465),
with channel policy review completed before selecting a distribution path.

The later candidate requires explicit test-mode QA covering authority, exact
retry, duplicated/out-of-order events, renewal/cancel/refund/grace timing,
provider outage, restore, household/payer moves, erasure, old-client behavior and
budget kill switches. Rehearse recovery against the same immutable candidate.
Stopping new checkout/renewals does not erase paid-until/receipt evidence or
require destructive schema rollback. No production rollback or refund is
performed by a documentation change. #145/#146/#377 retain release/operations
ownership; no new provider, cron, store listing or payment integration is active.

## Current disposition

Complete here: official-source price refresh and definition of all nine named
lifecycle areas. These are bounded document/research deliverables only.

Still absent: independent willingness-to-pay evidence, executed packaging test,
final feature/currency/price/cost/legal/operator/channel choices, go/revise/stop
decision, separate setup/spend/charging approval, implementation and original
QA/release acceptance. Keep #110 open and outside the beta-launch milestone.
