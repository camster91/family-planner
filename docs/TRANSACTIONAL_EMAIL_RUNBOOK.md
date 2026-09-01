# Transactional Email Release Runbook

**Owner:** Release owner  
**Status:** Provider-neutral preparation; changing secrets and sending external
email require explicit approval.

The evidence-based beta recommendation and exact approval boundary are recorded
in the [provider decision](TRANSACTIONAL_EMAIL_PROVIDER_DECISION.md).

## Release requirement

Family Planner is not ready for beta or production unless email verification
and password recovery are delivered by an approved provider from an explicitly
configured, provider-verified sender. A provider credential without
`EMAIL_FROM` is intentionally reported as `missing`; production does not fall
back to an implicit sender.

Configure exactly one provider path:

| Provider | Credential                               | Sender       |
| -------- | ---------------------------------------- | ------------ |
| Maton    | `MATON_API_KEY` or `MATON_API_KEY_ASHBI` | `EMAIL_FROM` |
| Resend   | `RESEND_API_KEY`                         | `EMAIL_FROM` |

`EMAIL_FROM` may include a display name, for example
`Family Planner <noreply@family.ashbi.ca>`, but its address or domain must be
verified with the selected provider. Never put credentials in the repository,
workflow output, issue comments, screenshots, or test fixtures.

## Review acceptance procedure

The release owner must approve the provider, sender, test recipient, and review
secret change before this procedure sends email.

1. Verify the sending address or domain in the provider console. Record only
   the non-secret verification result and date.
2. Add one approved provider credential and `EMAIL_FROM` to the Ashbi review
   runtime secret store. Remove any unused provider credential so precedence is
   unambiguous.
3. Restart the existing exact review image without rebuilding it.
4. Confirm `GET https://family-review.ashbi.ca/api/health` returns `healthy`,
   identifies the selected provider, and still reports a connected database.
5. Register a disposable parent account at a unique, owner-controlled inbox.
   Confirm the UI reports that verification was sent and the provider records
   an accepted and delivered event without a bounce.
6. Open the received verification link. Confirm its host is
   `family-review.ashbi.ca`, it succeeds once, reuse is rejected, and the
   verified account can sign in.
7. Request password recovery for the same account. Confirm the endpoint does
   not reveal whether unrelated addresses exist, the message arrives, the
   reset link succeeds once, the old password fails, and the new password
   succeeds.
8. Exercise resend throttling: repeated verification requests must return the
   generic response and eventually rate-limit without exposing account state.
9. Delete the disposable review account through the product deletion flow and
   record the non-sensitive test time, provider, sender domain, candidate SHA,
   and result in the release evidence.

## Failure and rollback

Do not invite beta households if health remains degraded, either message is not
delivered, links point to the wrong host, a one-time token can be reused, or the
provider reports a bounce or authentication error.

Restore the prior review secret configuration, restart the retained exact
image, and keep onboarding paused. Credential errors must be recorded without
the credential value. Application rollback is required only if the exact image
introduced the failure; secret rollback is sufficient for a configuration-only
failure.

## Production promotion

Review delivery proof does not authorize production. After the exact artifact
receives production approval, configure the separately approved production
credential and sender, promote the immutable image, and repeat health,
verification, recovery, provider-delivery, and one-time-token checks using a
production test inbox. Remove the test account afterward.
