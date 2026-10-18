"use client";

import { useId, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { listCreateMessages } from "@/i18n/list-create";

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
  const { locale } = useTranslation();
  const copy = listCreateMessages[locale];
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLDetailsElement>(null);
  const pending = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <details
      ref={section}
      data-testid="list-image-section"
      className="card-apple p-4"
    >
      <summary className="min-h-[44px] cursor-pointer text-body text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        {copy.imageTitle}{" "}
        <span className="text-footnote text-label-secondary">
          · {value ? copy.imageSelected : copy.imageOptional}
        </span>
      </summary>
      <div className="space-y-3 pt-2">
        <label htmlFor={id} className="sr-only">
          {copy.chooseImage}
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
              if (section.current) section.current.open = true;
              setError(copy.imageTooLarge);
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
              if (!response.ok) throw new Error(copy.imageUploadError);
              if (
                typeof data.url !== "string" ||
                !/^\/api\/files\/chores\/[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i.test(
                  data.url,
                )
              )
                throw new Error(copy.imageUploadError);
              onChange(data.url);
            } catch {
              if (section.current) section.current.open = true;
              setError(copy.imageUploadError);
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
              alt={copy.selectedImage}
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
              {copy.removeImage}
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn-plain min-h-[44px]"
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
        >
          {uploading
            ? copy.uploadingImage
            : value
              ? copy.replaceImage
              : copy.addImage}
        </button>
        <p className="text-footnote text-label-secondary">{copy.fileHint}</p>
        {error && (
          <p role="alert" className="text-footnote text-[var(--danger-text)]">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
