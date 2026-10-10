# List images

Lists can have one optional household image. The New List form keeps the picker
collapsed until requested, then provides upload, preview, replace, and remove
controls. Saving is disabled while an upload is pending. List summaries show a
thumbnail, and the list detail page shows the cover. Item image galleries are
outside this slice.

Uploads use the existing private household upload endpoint and file URLs. List
creation accepts only an existing upload belonging to the current household;
arbitrary remote URLs and another household's uploads are rejected. Attaching an
image locks the household and rechecks the creator's membership and role before
saving. Upload housekeeping checks list references both when finding candidates
and again under its household lock before deletion. Removing a selection clears
the reference rather than deleting a potentially shared file.

`List.image_url` is nullable. The migration adds the column idempotently and
leaves existing rows unchanged. Deploy the additive migration before running the
new application. Rolling back application code can retain the nullable column;
do not drop it while saved images are still needed.

Validation covers upload controls, save payloads, ownership rejection, and the
housekeeping attachment race. The rendered form preview uses isolated static
data. Full application build, authenticated end-to-end uploads, physical-device
behavior, and production migration/deployment remain release checks.
