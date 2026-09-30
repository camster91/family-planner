# Fridge photo scan (#265): enable, cap, disable

Owner: Cameron. The scan is **off** until the production container has `INVENTORY_SCAN_ANTHROPIC_API_KEY`.
Turning it on enables a paid provider and sends household photos to Anthropic, so every production step below
needs Cameron's explicit approval (AGENTS.md approval boundaries). Agents prepare; Cameron performs or approves.

What it does and why it is built this way: `docs/architecture/MEALS_AND_GROCERIES.md` §10 "Fridge photo scan".

## Environment variables (server runtime only, never `NEXT_PUBLIC_*`)

| Name | Required | Default | Meaning |
| --- | --- | --- | --- |
| `INVENTORY_SCAN_ANTHROPIC_API_KEY` | yes, to enable | unset (off) | Anthropic API key. Unset or blank: `POST /api/inventory/scan` is 404 and the page hides "Scan fridge". |
| `INVENTORY_SCAN_MODEL` | no | `claude-sonnet-5` | Anthropic model id for the scan. Anything that does not look like a model id falls back to the default. |
| `INVENTORY_SCAN_DAILY_LIMIT` | no | `20` | Scans per household per UTC day (0–500). `0` blocks every scan while leaving the feature configured. |

Fixed in code, not configurable: the provider host (`https://api.anthropic.com/v1/messages`), 8 MB per photo, 5 scans
per user and 10 per household per hour, at most 50 suggestions per photo.

The page reads the key at request time (the route is dynamic), so changing these needs a container restart with the
new environment, not a rebuild.

## 1. Account and key

1. In the Anthropic Console (console.anthropic.com), use the organisation that should be billed. Create a dedicated
   workspace, e.g. `family-planner-prod`, so this key's usage and limits are separate from anything else.
2. In that workspace set a **monthly spend limit** (Console → workspace → Limits). This is the hard money ceiling; the
   app's daily cap is only a per-household guard. Suggested start: a low limit (for example USD 10/month) and raise it
   once real usage is known.
3. Create an API key in that workspace named `family-planner-inventory-scan`. Store it in the password manager only.
   Do not paste it into GitHub, issues, chat, `.env.production.example` or any file in the repository.
4. Review the account's data-retention settings and Anthropic's commercial terms for API inputs, since household
   photos are sent there. Note the decision in the release record.

## 2. Estimate spend

Each scan is one Messages API request: one downscaled photo (the page resizes to at most 1568 px on the longest edge,
roughly 1,500–1,600 input tokens for the image) plus a short prompt, and a small JSON answer. At the model's list price
this is a fraction of a cent to about a cent per scan; check the current price for the configured model before
enabling. Worst case per day = households × `INVENTORY_SCAN_DAILY_LIMIT` scans. The workspace spend limit caps the
month regardless.

## 3. Enable (production, approval required)

Production containers inherit their environment from the running container on every release
(`.github/scripts/deploy-vps.sh`), so the variable is added once to the running container's configuration on the VPS,
in the same place as `JWT_SECRET` and the other runtime secrets:

1. With Cameron's approval, add `INVENTORY_SCAN_ANTHROPIC_API_KEY=<key>` (and optionally `INVENTORY_SCAN_DAILY_LIMIT`,
   `INVENTORY_SCAN_MODEL`) to the production app container's environment and recreate it. Do not print the value in
   shell history or logs (use an env file with mode 600, then delete it).
2. The household must also have the **Food inventory** feature on (Settings → Features; off by default).
3. Check: sign in as a parent, open `/dashboard/inventory`; "Scan fridge" is visible. Scan a test photo of a few
   obvious items; suggestions appear; add one and remove it. As a teen, the button is absent.
4. Check logs: `inventory.scan` lines carry only `bytes`, `type`, `items`, `dropped`, `ms`. There must be no
   item names, model text or image data.

## 4. Watch

- Logs: `inventory.scan` (success), `inventory.scan.failed` (`code`, `upstreamStatus`), `inventory.scan.error`.
- A run of `SCAN_PROVIDER_UNAVAILABLE` with `upstreamStatus` 401/403: the key was revoked or is wrong. 429/529:
  provider rate limit or overload; the app shows a retry message and the rest of the inventory keeps working.
- Anthropic Console usage for the workspace against its spend limit.

## 5. Change the cap

Set `INVENTORY_SCAN_DAILY_LIMIT` on the container and recreate it. `0` pauses scanning for everyone without removing
the key (households see "used today's fridge scans").

## 6. Disable or roll back

Remove `INVENTORY_SCAN_ANTHROPIC_API_KEY` from the container environment and recreate it. The route returns 404 and the
button disappears on the next page load; nothing else changes and no data needs cleaning (the scan stores nothing).
If the key may have leaked, also revoke it in the Anthropic Console (credential rotation: Cameron's approval).
