/**
 * Device storage names shared by the generic queue contract and the paired
 * device client. Keep this module dependency-free so personal queue bundles
 * do not import the credential-bearing device client just to name a database.
 */
export const DEVICE_STORAGE_PREFIX = "fp-device:v1:";
export const DEVICE_IDB_NAME = "fp-device";
export const DEVICE_CACHE_PREFIX = "fp-device";
/** Stored device id; a different id on this browser triggers a purge. */
export const DEVICE_ID_KEY = `${DEVICE_STORAGE_PREFIX}device-id`;
/** Reserved for the offline mutation queue; purge drops it without replaying. */
export const DEVICE_QUEUE_KEY = `${DEVICE_STORAGE_PREFIX}queue`;
