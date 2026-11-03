"use client";
import * as React from "react";
import type { GoogleRecipeDiscovery } from "@/lib/google-recipe-search-response";
import { useRecipeExploreText } from "@/i18n/recipe-explore";

// Provider CSS/HTML must never share the app origin or access household data.
const suggestionPrefix =
  "<!doctype html><html><head><meta name=\"referrer\" content=\"no-referrer\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'\"></head><body>";
export function GroundedRecipeResults({
  discovery,
  disabled,
  onPreview,
}: {
  discovery: GoogleRecipeDiscovery;
  disabled: boolean;
  onPreview: (url: string) => void;
}) {
  const text = useRecipeExploreText();
  const sources = Array.from(
    new Map(
      discovery.blocks.flatMap((block) =>
        block.annotations.map((a) => [a.url, a] as const),
      ),
    ).values(),
  );
  return (
    <section aria-label={text("groundedTitle")} className="space-y-3 min-w-0">
      <h3 className="text-headline">{text("groundedTitle")}</h3>
      {discovery.blocks.map((block, index) => {
        // Preserve the complete answer and attach every citation at its end offset.
        const ends = Array.from(
          new Set([
            ...block.annotations.map((a) => a.end_index),
            block.text.length,
          ]),
        ).sort((a, b) => a - b);
        let previous = 0;
        return (
          <p
            key={index}
            className="text-subhead whitespace-pre-wrap break-words"
          >
            {ends.map((end) => {
              const segment = block.text.slice(previous, end);
              previous = end;
              return (
                <React.Fragment key={end}>
                  {segment}
                  {block.annotations
                    .filter((a) => a.end_index === end)
                    .map((a, i) => (
                      <a
                        key={`${a.url}-${i}`}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center underline"
                        aria-label={`${text("groundedSource")}: ${a.title}`}
                      >
                        [{sources.findIndex((s) => s.url === a.url) + 1}]
                      </a>
                    ))}
                </React.Fragment>
              );
            })}
          </p>
        );
      })}
      {discovery.suggestions.map((html, index) => (
        <iframe
          key={index}
          title={`${text("groundedSuggestions")} ${index + 1}`}
          className="w-full min-w-0 h-40 border-0 rounded-lg"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={`${suggestionPrefix}${html}</body></html>`}
        />
      ))}
      <ul className="space-y-2">
        {sources.map((source, index) => (
          <li
            key={source.url}
            className="rounded-xl border border-[var(--surface-separator)] p-3 min-w-0"
          >
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block min-h-11 break-words underline"
            >
              {index + 1}. {source.title || new URL(source.url).hostname}
            </a>
            <button
              type="button"
              className="btn-plain min-h-11"
              disabled={disabled}
              onClick={() => onPreview(source.url)}
            >
              {text("groundedPreview")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
