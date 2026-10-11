import { handoffEnglish, handoffSpanish } from "../handoff";

it("keeps handoff confirmation copy in EN/ES key and placeholder parity", () => {
  expect(Object.keys(handoffSpanish).sort()).toEqual(
    Object.keys(handoffEnglish).sort(),
  );
  for (const [key, english] of Object.entries(handoffEnglish)) {
    const spanish = handoffSpanish[key as keyof typeof handoffSpanish];
    expect(english.trim()).not.toBe("");
    expect(spanish.trim()).not.toBe("");
    expect([...english.matchAll(/\{[^}]+\}/g)].map(([token]) => token)).toEqual(
      [...spanish.matchAll(/\{[^}]+\}/g)].map(([token]) => token),
    );
  }
});
