import { MEMBER_COLOR_CSS, isMemberColorKey } from "@/lib/member-colors";

type Person = { kind: string; id: string; name: string; color: string };

/**
 * The people an event is for, as colour dots next to their names. Colour is
 * decoration beside a visible name and never carries meaning on its own.
 * Renders nothing for an event with no people.
 */
export function EventPeopleLine({ people, label, className }: { people?: ReadonlyArray<Person> | null; label: string; className?: string }) {
  if (!people || people.length === 0) return null;
  return (
    <span data-testid="event-people-line" className={className} aria-label={`${label} ${people.map((p) => p.name).join(", ")}`}>
      {people.map((person) => (
        <span key={`${person.kind}:${person.id}`} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: "0.3em", marginInlineEnd: "0.6em", maxWidth: "100%" }}>
          <span
            style={{
              width: "0.6em", height: "0.6em", borderRadius: "9999px", flex: "none",
              background: isMemberColorKey(person.color) ? MEMBER_COLOR_CSS[person.color] : "currentColor",
            }}
          />
          <span style={{ overflowWrap: "anywhere" }}>{person.name}</span>
        </span>
      ))}
    </span>
  );
}
