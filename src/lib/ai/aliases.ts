/**
 * Household name aliasing for app-held AI (#144, owner decision 2026-11-19).
 *
 * Before anything is sent to a provider, the server replaces the names of
 * household people with placeholders ("Person A", "Person B", or "Child A"
 * when the caller marks a person as a child), and maps placeholders in the
 * provider's answer back to real people afterwards. The provider never sees a
 * household member's name, id or colour. Text the person typed that is not a
 * household name (a teacher, a shop) is left alone.
 *
 * Pure and dependency-free so it can be unit-tested and reused by every AI
 * feature.
 */

export type AliasKind = "person" | "child";

export interface AliasInputPerson {
  /** Opaque server key, e.g. "account:<id>" or "profile:<id>". Never sent. */
  key: string;
  name: string;
  kind?: AliasKind;
}

export interface AliasEntry {
  alias: string;
  key: string;
  name: string;
}

export interface AliasTable {
  entries: AliasEntry[];
}

/** Single words never treated as a first name on their own (dates would break). */
const SINGLE_TOKEN_STOPLIST = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "today",
  "tomorrow",
  "person",
  "child",
  "mom",
  "dad",
]);

function letterLabel(index: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB ...
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function cleanName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Stable placeholders in the order given (household order). Blank names are skipped. */
export function buildAliasTable(
  people: ReadonlyArray<AliasInputPerson>,
): AliasTable {
  const counters: Record<AliasKind, number> = { person: 0, child: 0 };
  const entries: AliasEntry[] = [];
  const seen = new Set<string>();
  for (const person of people) {
    const name = cleanName(person.name);
    if (!name || seen.has(person.key)) continue;
    seen.add(person.key);
    const kind = person.kind ?? "person";
    const prefix = kind === "child" ? "Child" : "Person";
    entries.push({
      alias: `${prefix} ${letterLabel(counters[kind]++)}`,
      key: person.key,
      name,
    });
  }
  return { entries };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BEFORE = "(?<![\\p{L}\\p{N}_])";
const AFTER = "(?![\\p{L}\\p{N}_])";

type Pattern = { regex: RegExp; replacement: string; length: number };

/** First names that are also everyday words: matched only when capitalized. */
const COMMON_WORD_NAMES = new Set([
  "will",
  "mark",
  "bill",
  "rose",
  "grace",
  "hope",
  "joy",
  "faith",
  "sky",
  "summer",
  "autumn",
  "dawn",
  "hunter",
  "chase",
  "page",
  "max",
  "art",
  "sunny",
  "ash",
  "bob",
  "jack",
  "pat",
  "sue",
  "frank",
  "lily",
  "olive",
  "ruby",
  "pearl",
  "river",
  "reed",
  "wade",
  "drew",
  "rich",
]);

function tokenRegex(token: string): RegExp {
  // Month/weekday-like names (April, June, May) are real names too: alias
  // them only when written capitalized and not directly followed by a number,
  // so "April 3" stays a date while "April's dentist" is aliased.
  const dateLike = SINGLE_TOKEN_STOPLIST.has(token.toLowerCase());
  return new RegExp(
    `${BEFORE}${escapeRegExp(token)}${AFTER}${dateLike ? "(?!\\s*\\d)" : ""}`,
    dateLike || COMMON_WORD_NAMES.has(token.toLowerCase()) ? "gu" : "giu",
  );
}

function patternsFor(table: AliasTable): Pattern[] {
  const patterns: Pattern[] = [];
  // Single words that name more than one person (a shared first name, or one
  // person's whole name equal to another's first name) become an explicit
  // "either" so the person reviews who it is for.
  const byToken = new Map<string, AliasEntry[]>();
  const add = (token: string, entry: AliasEntry) =>
    byToken.set(token, [...(byToken.get(token) ?? []), entry]);
  for (const entry of table.entries) {
    const first = entry.name.split(" ")[0];
    if (first.length >= 2) add(first, entry);
  }
  // Full multi-word names (case-insensitive), longest first.
  for (const entry of table.entries) {
    if (!entry.name.includes(" ")) continue;
    patterns.push({
      regex: new RegExp(`${BEFORE}${escapeRegExp(entry.name)}${AFTER}`, "giu"),
      replacement: entry.alias,
      length: entry.name.length,
    });
  }
  for (const [token, entries] of byToken) {
    const unique = [...new Map(entries.map((e) => [e.key, e])).values()];
    // Names match case-insensitively ("casey" too), except first names that
    // are also everyday words ("will", "mark"), which must be capitalized.
    patterns.push({
      regex: tokenRegex(token),
      replacement:
        unique.length === 1
          ? unique[0].alias
          : `(${unique.map((e) => e.alias).join(" or ")})`,
      length: token.length,
    });
  }
  return patterns.sort((a, b) => b.length - a.length);
}

/**
 * Replace household names in free text with placeholders. Uses one combined
 * pass per pattern on protected text, so a replacement is never re-matched.
 */
export function aliasText(text: string, table: AliasTable): string {
  const patterns = patternsFor(table);
  if (patterns.length === 0) return text;
  // Tokenize replacements with private-use markers, then expand at the end.
  const replacements: string[] = [];
  let working = text.normalize("NFC");
  for (const pattern of patterns) {
    working = working.replace(pattern.regex, () => {
      replacements.push(pattern.replacement);
      return `${replacements.length - 1}`;
    });
  }
  return working.replace(/(\d+)/g, (_, i: string) => replacements[Number(i)]);
}

/** Map placeholders in provider text back to real display names. */
export function unaliasText(text: string, table: AliasTable): string {
  const sorted = [...table.entries].sort(
    (a, b) => b.alias.length - a.alias.length,
  );
  let working = text;
  const names: string[] = [];
  for (const entry of sorted) {
    working = working.replace(
      new RegExp(`${BEFORE}${escapeRegExp(entry.alias)}${AFTER}`, "gu"),
      () => {
        names.push(entry.name);
        return `${names.length - 1}`;
      },
    );
  }
  return working.replace(/(\d+)/g, (_, i: string) => names[Number(i)]);
}

/** The server key for a placeholder, or null when the provider invented one. */
export function resolveAlias(alias: string, table: AliasTable): string | null {
  const wanted = alias
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return (
    table.entries.find((e) => e.alias.toLowerCase() === wanted)?.key ?? null
  );
}

/** Placeholders only — what a provider may be told about the household's people. */
export function aliasRoster(table: AliasTable): string[] {
  return table.entries.map((e) => e.alias);
}

/** True when no household name survives in `text` (used by tests and a server assertion). */
export function containsHouseholdName(
  text: string,
  table: AliasTable,
): boolean {
  const lower = text.normalize("NFC").toLowerCase();
  return table.entries.some((entry) => {
    const re = new RegExp(
      `${BEFORE}${escapeRegExp(entry.name.toLowerCase())}${AFTER}`,
      "u",
    );
    return re.test(lower);
  });
}
