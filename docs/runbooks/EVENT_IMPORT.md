# Event import from text, photo or PDF (#270): enable, cap, disable

Owner: Cameron. The import is **off** until the production container has `EVENT_IMPORT_ANTHROPIC_API_KEY`. Turning
it on enables a paid provider and sends household emails, flyer photos and PDFs to Anthropic, so every production
step below needs Cameron's explicit approval (AGENTS.md approval boundaries). Agents prepare; Cameron performs or
approves.

What it does and why it is built this way: `docs/architecture/CALENDAR_IMPORT.md` "Review-first import from text,
photo or PDF". API: `docs/architecture/API_CONTRACTS.md` "Review-first event import".

## Environment variables (server runtime only, never `NEXT_PUBLIC_*`)

| Name | Required | Default | Meaning |
| --- | --- | --- | --- |
| `EVENT_IMPORT_ANTHROPIC_API_KEY` | yes, to enable | unset (off) | Anthropic API key. Unset or blank: `POST /api/calendar/import-suggestions` is 404 and the calendar hides "Import from text or photo". |
| `EVENT_IMPORT_MODEL` | no | `claude-sonnet-5` | Anthropic model id. Anything that does not look like a model id falls back to the default. Must accept images and PDF `document` blocks with structured output. |
| `EVENT_IMPORT_DAILY_LIMIT` | no | `30` | Imports per household per UTC day (0–500). `0` blocks every import while leaving the feature configured. |

Fixed in code, not configurable: the provider host (`https://api.anthropic.com/v1/messages`), 20,000 characters of
text, 8 MB per photo, 10 MB and 20 visible pages per PDF, 45 s timeout, 10 imports per person and 20 per household per
hour, at most 30 suggestions per import, the 10-minute undo window.

**Why its own key, not `INVENTORY_SCAN_ANTHROPIC_API_KEY`** (the fridge photo scan, #265): one key per feature lets
each live in its own Anthropic workspace with its own monthly spend limit and usage view, lets a leaked or abused key
be revoked without switching the other feature off, and keeps each feature's kill switch independent. Sharing one
key would also mean one workspace limit silently caps both features. Both keys may belong to the same organisation.

The page and route read the key at request time (both are dynamic), so changing these needs a container restart with
the new environment, not a rebuild.

## 1. Account and key

1. In the Anthropic Console (console.anthropic.com), use the organisation that should be billed. Create a dedicated
   workspace, e.g. `family-planner-event-import`, so this key's usage and limits are separate from anything else.
2. In that workspace set a **monthly spend limit** (Console → workspace → Limits). This is the hard money ceiling;
   the app's daily cap is only a per-household guard. Suggested start: a low limit (for example USD 10/month), raised
   once real usage is known.
3. Create an API key in that workspace named `family-planner-event-import`. Store it in the password manager only.
   Do not paste it into GitHub, issues, chat, `.env.production.example` or any file in the repository.
4. Review the account's data-retention settings and Anthropic's commercial terms for API inputs, since household
   emails, school flyers (which can name children, schools and addresses) and PDFs are sent there. Note the decision
   in the release record.

## 2. Estimate spend

Each import is one Messages API request with low effort and a short JSON answer (up to 30 events):

- **Text:** up to 20,000 characters (roughly 5,000 input tokens at most; a typical school email is well under 1,000).
- **Photo:** downscaled by the page to at most 1568 px on the longest edge, roughly 1,500–1,600 input tokens.
- **PDF:** each page is sent as text plus a page image, roughly 1,500–3,000 tokens per page; 20 visible pages is the
  best-effort cap (PDFs that hide their page tree in compressed streams are only bounded by the 10 MB limit, so the
  workspace spend limit is the real ceiling).

At the default model's list price this is about a cent for a typical email or photo and a few cents for a multi-page
PDF; check the current price for the configured model before enabling. Worst case per day = households ×
`EVENT_IMPORT_DAILY_LIMIT` imports. The workspace spend limit caps the month regardless.

## 3. Enable (production, approval required)

Production containers inherit their environment from the running container on every release
(`.github/scripts/deploy-vps.sh`), so the variable is added once to the running container's configuration on the VPS,
in the same place as `JWT_SECRET` and the other runtime secrets:

1. With Cameron's approval, add `EVENT_IMPORT_ANTHROPIC_API_KEY=<key>` (and optionally `EVENT_IMPORT_DAILY_LIMIT`,
   `EVENT_IMPORT_MODEL`) to the production app container's environment and recreate it. Do not print the value in
   shell history or logs (use an env file with mode 600, then delete it).
2. Check: sign in as a parent, open `/dashboard/calendar`; "Import from text or photo" is visible. Paste a short test
   email ("Picture day next Friday. Bake sale Oct 9, 3:30–5pm in the gym."); two suggestions appear with the right
   dates; add them, then press Undo in the toast and confirm both are gone. Try a photo and a one-page PDF.
3. Check logs: `event.import` lines carry only `userId`, `kind`, `size`, `suggestions`, `dropped`, `unreadable`,
   `refused`, `ms`. There must be no email text, titles, model output or file data.

## 4. Watch

- Logs: `event.import` (success), `event.import.failed` (`code`, `upstreamStatus`), `event.import.error`,
  `event.import.undo` (`requested`, `removed`).
- A run of `IMPORT_PROVIDER_UNAVAILABLE` with `upstreamStatus` 401/403: the key was revoked or is wrong. 429/529:
  provider rate limit or overload; people see a retry message and the calendar keeps working. 400: the configured
  model may not accept the request shape (check `EVENT_IMPORT_MODEL`).
- Many `refused: true` or `unreadable: true`: poor inputs or a model change; the page shows "We couldn't find any
  dates in this".
- Anthropic Console usage for the workspace against its spend limit.

## 5. Change the cap

Set `EVENT_IMPORT_DAILY_LIMIT` on the container and recreate it. `0` pauses importing for everyone without removing
the key (households see "used today's imports").

## 6. Disable or roll back

Remove `EVENT_IMPORT_ANTHROPIC_API_KEY` from the container environment and recreate it. The suggestion route returns
404 and the button disappears on the next page load; events already added stay (they are ordinary events), and Undo
keeps working for its 10 minutes because it never calls the provider. No data needs cleaning (the import stores
nothing). If the key may have leaked, also revoke it in the Anthropic Console (credential rotation: Cameron's
approval).

## 7. Email forwarding (not built)

Forwarding school emails to a household address is designed but dormant: `docs/architecture/CALENDAR_IMPORT.md`
"Email forwarding (dormant design)". It needs Cameron to choose an inbound-mail provider, set up MX/DNS for an inbound
subdomain and approve a small pending-suggestions table before any code is written.

## Follow-up

Once the fridge photo scan (#265) is merged, move the helpers this feature duplicates from it (text cleaning, config
parsing, the Messages API call with structured output and error mapping) into one shared module, keeping one key and
one set of limits per feature.
