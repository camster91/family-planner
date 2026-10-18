import { NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/device-route";
import { deviceJson, deviceInternalError, killSwitch } from "@/lib/device-http";
import { getRequestId } from "@/lib/request-id";
import { QUEUE_OWNER_CONTRACT } from "@/lib/queue-owner-contract";
import {
  isQueueOwnerRecoveryEnabled,
  deviceQueueOwner,
} from "@/lib/queue-owner-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const off = killSwitch();
  if (off) return off;
  try {
    const auth = await authenticateDevice(request);
    if (!auth.ok) return auth.response;
    return deviceJson(
      isQueueOwnerRecoveryEnabled()
        ? {
            contract: QUEUE_OWNER_CONTRACT,
            enabled: true,
            owner: deviceQueueOwner(auth.actor),
          }
        : { contract: QUEUE_OWNER_CONTRACT, enabled: false },
    );
  } catch (error) {
    return deviceInternalError(
      "device.queue-owner",
      error,
      getRequestId(request),
    );
  }
}
