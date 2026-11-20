import { PersonChip } from "@/components/ui/person-chip";

type Person = { kind: string; id: string; name: string; color: string };

/**
 * The people an event is for, as person chips: the initial on the person's
 * colour and their first name. Colour is decoration beside a visible name and
 * never carries meaning on its own. Renders nothing for an event with no
 * people.
 */
export function EventPeopleLine({ people, label, className }: { people?: ReadonlyArray<Person> | null; label: string; className?: string }) {
  if (!people || people.length === 0) return null;
  return (
    <span data-testid="event-people-line" className={["inline-flex max-w-full flex-wrap items-center gap-1", className].filter(Boolean).join(" ")}>
      {label && <span className="sr-only">{label} </span>}
      {people.map((person) => (
        <PersonChip key={`${person.kind}:${person.id}`} name={person.name} color={person.color} />
      ))}
    </span>
  );
}
