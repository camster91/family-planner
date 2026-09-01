"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckSquare,
  List,
  Search,
  UserRound,
} from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";

type SearchResult = {
  id: string;
  type: "chore" | "event" | "list" | "person";
  title: string;
  detail: string;
  href: string;
};

const resultMeta = {
  chore: { label: "Chore", icon: CheckSquare },
  event: { label: "Event", icon: CalendarDays },
  list: { label: "List", icon: List },
  person: { label: "Family", icon: UserRound },
};

export default function SearchPage() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(normalized)}`,
          {
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Search failed");
        setResults(payload.results);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") {
          setResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "Search failed",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const showPrompt = query.trim().length < 2;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-large-title font-display">Search</h1>
        <p className="text-subhead text-label-secondary mt-0.5">
          Find chores, events, lists, and people in your family
        </p>
      </div>

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search your family"
        className="w-full"
      />

      <div aria-live="polite" aria-busy={loading}>
        {showPrompt ? (
          <EmptyState
            title="Search everything"
            detail="Type at least 2 characters to search your family."
          />
        ) : loading ? (
          <div className="card-apple p-8 text-center text-subhead text-label-secondary">
            Searching…
          </div>
        ) : error ? (
          <div className="card-apple p-6 text-center text-subhead text-[var(--destructive)]">
            {error}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            title={`No results for “${query.trim()}”`}
            detail="Try a different name or keyword."
          />
        ) : (
          <div className="card-apple divide-y divide-[var(--surface-separator)] overflow-hidden">
            {results.map((result) => {
              const meta = resultMeta[result.type];
              const Icon = meta.icon;
              return (
                <Link
                  key={`${result.type}:${result.id}`}
                  href={result.href}
                  className="flex items-center gap-3 p-4 hover:bg-[var(--surface-fill-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                >
                  <span className="w-10 h-10 rounded-full bg-[var(--surface-fill)] flex items-center justify-center shrink-0">
                    <Icon
                      className="w-5 h-5 text-label-secondary"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-label-primary truncate">
                      {result.title}
                    </span>
                    <span className="block text-footnote text-label-secondary truncate">
                      {result.detail}
                    </span>
                  </span>
                  <span className="text-caption-1 text-label-tertiary">
                    {meta.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      className={cn("card-apple p-8 text-center", "flex flex-col items-center")}
    >
      <div className="w-16 h-16 rounded-full bg-[var(--surface-fill)] flex items-center justify-center mb-4">
        <Search className="w-7 h-7 text-label-tertiary" aria-hidden="true" />
      </div>
      <h2 className="text-title-3 text-label-primary mb-1">{title}</h2>
      <p className="text-subhead text-label-secondary max-w-sm">{detail}</p>
    </div>
  );
}
