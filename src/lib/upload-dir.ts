/**
 * The one place that decides where uploaded files live.
 *
 * Upload, file serving and account deletion must agree on this path: if one of
 * them treats an empty UPLOAD_DIR as "use the default" and another as "the
 * current directory", deletion silently misses the photos it should remove.
 * Unset, empty and whitespace-only values all mean the default.
 */
export const DEFAULT_UPLOAD_DIR = '/data/family-planner-uploads'

export function resolveUploadDir(env: Record<string, string | undefined> = process.env): string {
  return env.UPLOAD_DIR?.trim() || DEFAULT_UPLOAD_DIR
}
