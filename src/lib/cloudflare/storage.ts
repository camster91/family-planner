import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { R2Bucket, R2HTTPMetadata, R2ObjectBody } from '@cloudflare/workers-types'

/**
 * The one request-scoped lookup for the private object store.  The bucket is
 * deliberately not exposed through a public URL: every caller must resolve
 * ownership in D1 before asking R2 for an object.
 */
export type PrivateObjectStore = Pick<R2Bucket, 'head' | 'get' | 'put' | 'delete'>

export const PRIVATE_OBJECT_BINDING = 'UPLOADS'

export async function getPrivateObjectStore(): Promise<PrivateObjectStore> {
  const { env } = getCloudflareContext()
  const bucket = (env as typeof env & { UPLOADS?: PrivateObjectStore }).UPLOADS
  if (!bucket) throw new Error('Private R2 binding UPLOADS is required')
  return bucket
}

/**
 * R2 keys include the owning family and namespace.  The database still stores
 * the existing opaque filename/id API contract, while a foreign household can
 * never accidentally adopt a same-named object.
 */
export function privateObjectKey(familyId: string, namespace: 'chores' | 'messages', filename: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(familyId)) throw new Error('Invalid family object namespace')
  if (!/^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i.test(filename) &&
      !/^[a-f0-9]{32}\.(jpg|png|webp|heic)$/i.test(filename)) {
    throw new Error('Invalid private object filename')
  }
  return `families/${familyId}/${namespace}/${filename}`
}

/** Immutable generation key for newly admitted private objects. The database
 * row id is part of the key, so a retired upload can never delete a later
 * same-filename replacement, even if an old R2 delete is delayed. The
 * three-argument privateObjectKey remains the legacy expand-phase fallback. */
export function privateObjectGenerationKey(
  familyId: string,
  namespace: 'chores' | 'messages',
  filename: string,
  generationId: string,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(generationId)) throw new Error('Invalid private object generation')
  return `families/${familyId}/${namespace}/${generationId}/${filename}`
}

export type PrivateObject = {
  body: R2ObjectBody['body']
  etag?: string
  httpMetadata?: R2HTTPMetadata
}

export function privateObjectResponseMetadata(object: PrivateObject): { etag?: string; contentType?: string } {
  return {
    etag: object.etag,
    contentType: object.httpMetadata?.contentType,
  }
}
