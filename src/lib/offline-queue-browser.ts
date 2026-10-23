"use client";

/**
 * Compatibility entrypoint for browser queue APIs.
 *
 * Keep this barrel stable for auth, account, navigation, and existing tests;
 * feature surfaces should import their person/device entrypoint directly so
 * the opposite queue and its device client are not pulled into their graph.
 */
export {
  clearAllPersonQueues,
  getPersonQueue,
  readPersonQueueDiagnostics,
  retireErasedAccountQueues,
  retirePersonQueueGeneration,
} from "@/lib/person-queue-browser";
export { deviceQueueSend, getDeviceQueue } from "@/lib/device-queue-browser";
