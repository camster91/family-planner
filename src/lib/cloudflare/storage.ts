import { getCloudflareContext } from "@opennextjs/cloudflare";
import type {
  R2Bucket,
  R2HTTPMetadata,
  R2ObjectBody,
} from "@cloudflare/workers-types";
export {
  privateObjectGenerationKey,
  privateObjectKey,
} from "./private-object-keys";

/**
 * The one request-scoped lookup for the private object store.  The bucket is
 * deliberately not exposed through a public URL: every caller must resolve
 * ownership in D1 before asking R2 for an object.
 */
export type PrivateObjectStore = Pick<
  R2Bucket,
  "head" | "get" | "put" | "delete"
>;

export const PRIVATE_OBJECT_BINDING = "UPLOADS";

export async function getPrivateObjectStore(): Promise<PrivateObjectStore> {
  const { env } = getCloudflareContext();
  const bucket = (env as typeof env & { UPLOADS?: PrivateObjectStore }).UPLOADS;
  if (!bucket) throw new Error("Private R2 binding UPLOADS is required");
  return bucket;
}

/** Runtime adapter injected into native deletion routes, not D1 kernels. */
export async function deletePrivateObject(key: string): Promise<void> {
  const bucket = await getPrivateObjectStore();
  await bucket.delete(key);
}

/**
 * R2 keys include the owning family and namespace.  The database still stores
 * the existing opaque filename/id API contract, while a foreign household can
 * never accidentally adopt a same-named object.
 */
export type PrivateObject = {
  body: R2ObjectBody["body"];
  etag?: string;
  httpMetadata?: R2HTTPMetadata;
};

export function privateObjectResponseMetadata(object: PrivateObject): {
  etag?: string;
  contentType?: string;
} {
  return {
    etag: object.etag,
    contentType: object.httpMetadata?.contentType,
  };
}
