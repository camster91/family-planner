/** Native bridges may ignore AbortSignal. Timeout is always an unknown outcome. */
export async function inventoryWriteDeadline<T extends { kind: string }>(
  run: () => Promise<T>,
): Promise<T | { kind: "unknown" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<{ kind: "unknown" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "unknown" }), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
