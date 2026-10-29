/** Pure private-object key contracts used by both D1 and the R2 adapter. */

export type PrivateObjectNamespace = "chores" | "messages";

export function privateObjectKey(
  familyId: string,
  namespace: PrivateObjectNamespace,
  filename: string,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(familyId))
    throw new Error("Invalid family object namespace");
  if (
    !/^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i.test(filename) &&
    !/^[a-f0-9]{32}\.(jpg|png|webp|heic)$/i.test(filename)
  ) {
    throw new Error("Invalid private object filename");
  }
  return `families/${familyId}/${namespace}/${filename}`;
}

/** Immutable generation key for newly admitted private objects. */
export function privateObjectGenerationKey(
  familyId: string,
  namespace: PrivateObjectNamespace,
  filename: string,
  generationId: string,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(generationId))
    throw new Error("Invalid private object generation");
  return `families/${familyId}/${namespace}/${generationId}/${filename}`;
}
