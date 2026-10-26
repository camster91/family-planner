/** Browser-safe chore upload limits and canonical private file references. */
export const CHORE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const CHORE_PHOTO_FILENAME_RE = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i;
export const CHORE_PHOTO_PATH_PREFIX = "/api/files/chores/";
export function isChorePhotoPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CHORE_PHOTO_PATH_PREFIX)
    && CHORE_PHOTO_FILENAME_RE.test(value.slice(CHORE_PHOTO_PATH_PREFIX.length));
}
