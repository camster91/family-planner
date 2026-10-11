# Calendar Capture sheet alignment

## Scope

Calendar Quick add remains at `/dashboard/calendar`, but its capture editor opens from a 44px launcher in the existing rounded `Dialog` form sheet. The sheet uses the shared focus trap, Escape handling, opener restoration, mobile safe-area padding and internal scroll boundary. The CaptureBox stays mounted after the launcher is first rendered so an unsent proposal or photo review survives close and reopen.

## State and privacy contract

- Opening and closing the sheet never writes an event, grocery item or provider request.
- A person must explicitly review and confirm a proposal before the existing canonical API is called.
- Pending interpretation, photo processing, confirmation, receipt status and retry operations disable dismissal until their request settles.
- Closing preserves transient text, proposals and photo rows. The explicit discard controls still clear only the selected proposal/rows. Durable receipt envelopes keep their existing household/user namespace, six-day retention, request hash and idempotency key.
- Capture availability remains the existing `/api/capture` role/configuration gate. Children do not receive a launcher or provider access; Calendar's existing role boundary is unchanged.

## Evidence

`capture-receipt-recovery.spec.ts` continues the actual receipt/reload/deletion/partial-photo journey. `capture-sheet-alignment.spec.ts` checks EN/ES chrome, light/dark theme, opener focus, sheet bounds, 44px controls, no writes, no horizontal overflow and serious/critical Axe violations at the six representative project sizes. The browser matrix and optimized build remain release gates owned by the integration checkout.
