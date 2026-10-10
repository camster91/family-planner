"use client";
import { useId, useRef, useState } from "react";
export function ListImagePicker({
  value,
  onChange,
  disabled = false,
  onBusyChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    pending = useRef(false);
  const [uploading, setUploading] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <details className="card-apple p-4">
      <summary className="min-h-[44px] cursor-pointer text-body text-label-primary">
        List image{" "}
        <span className="text-footnote text-label-secondary">
          · {value ? "Image selected" : "Optional"}
        </span>
      </summary>
      <div className="space-y-3 pt-2">
        <label htmlFor={id} className="sr-only">
          Choose list image
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/webp,image/heic"
          disabled={disabled || uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || disabled || pending.current) return;
            setError(null);
            if (file.size > 5 * 1024 * 1024) {
              setError("Choose an image smaller than 5 MB.");
              return;
            }
            pending.current = true;
            setUploading(true);
            onBusyChange(true);
            try {
              const body = new FormData();
              body.append("file", file);
              const response = await fetch("/api/upload", {
                method: "POST",
                body,
              });
              const data = await response.json();
              if (!response.ok)
                throw new Error(
                  data.error || "Image upload failed. Try again.",
                );
              if (
                typeof data.url !== "string" ||
                !/^\/api\/files\/chores\/[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i.test(
                  data.url,
                )
              )
                throw new Error("Image upload failed. Try again.");
              onChange(data.url);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Image upload failed. Try again.",
              );
            } finally {
              pending.current = false;
              setUploading(false);
              onBusyChange(false);
            }
          }}
        />
        {value && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Selected list image"
              width={320}
              height={160}
              className="w-full max-h-40 object-contain rounded-lg bg-[var(--surface-fill)]"
            />
            <button
              type="button"
              className="btn-plain min-h-[44px]"
              disabled={disabled || uploading}
              onClick={() => {
                onChange(null);
                setError(null);
              }}
            >
              Remove image
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn-filled min-h-[44px]"
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? "Uploading…" : value ? "Replace image" : "Add image"}
        </button>
        <p className="text-footnote text-label-secondary">
          JPEG, PNG, WebP or HEIC · up to 5 MB. Shared with your household.
        </p>
        {error && (
          <p role="alert" className="text-footnote text-[var(--danger-text)]">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
