/** Compatibility tombstone only; no signaling, capture, storage or providers. */
export function retiredCallingResponse() {
  return new Response(null, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
export function retireCallSocket(socket: {
  close(code: number, reason: string): void;
}) {
  try {
    socket.close(4003, "Calling removed");
  } catch {
    /* already closed */
  }
}

export function isRetiredCallingPath(path: string) {
  return (
    path === "/api/calls" ||
    path.startsWith("/api/calls/") ||
    path === "/api/device/calls" ||
    path.startsWith("/api/device/calls/")
  );
}
