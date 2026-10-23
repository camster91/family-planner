import type { CaptureMessage } from "@/i18n/capture";

type CaptureErrorFactory = (key: CaptureMessage) => Error;

// Shrink a photo before sending it to the model. Keep this browser-only work
// behind the photo action so the eagerly mounted calendar capture box does not
// carry FileReader, Image, and canvas processing code in its initial graph.
export async function downscaleImage(
  file: File,
  maxEdge = 1600,
  signal: AbortSignal | undefined,
  createError: CaptureErrorFactory,
): Promise<{ base64: string; mimeType: string }> {
  if (signal?.aborted) throw createError("readInterrupted");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      signal?.removeEventListener("abort", stop);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const stop = () => {
      cleanup();
      reader.abort();
      reject(createError("readInterrupted"));
    };
    reader.onload = () => {
      const value = String(reader.result);
      cleanup();
      resolve(value);
    };
    reader.onerror = () => {
      cleanup();
      reject(createError("fileReadFailed"));
    };
    reader.onabort = () => {
      cleanup();
      reject(createError("readInterrupted"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    reader.readAsDataURL(file);
  });
  if (signal?.aborted) throw createError("readInterrupted");
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const cleanup = () => {
      signal?.removeEventListener("abort", stop);
      el.onload = null;
      el.onerror = null;
    };
    const stop = () => {
      cleanup();
      el.removeAttribute("src");
      reject(createError("readInterrupted"));
    };
    el.onload = () => {
      cleanup();
      resolve(el);
    };
    el.onerror = () => {
      cleanup();
      el.removeAttribute("src");
      reject(createError("imageReadFailed"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    el.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  try {
    if (signal?.aborted) throw createError("readInterrupted");
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw createError("imageProcessFailed");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.82);
    return { base64: out.split(",")[1] || "", mimeType: "image/jpeg" };
  } finally {
    img.removeAttribute("src");
    canvas.width = 0;
    canvas.height = 0;
  }
}
