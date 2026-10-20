import { describeFood } from "../food-description";
it("extracts one explicit restocking description without inferring expiry or package conversion", () => {
  expect(describeFood("Add 2 cans of beans to the pantry")).toEqual({
    kind: "review",
    draft: { name: "beans", amount: 2, unit: "cans", location: "pantry" },
  });
  expect(describeFood("milk")).toEqual({
    kind: "review",
    draft: { name: "milk" },
  });
  expect(describeFood("add 1.5 kg flour in the pantry")).toEqual({
    kind: "review",
    draft: { name: "flour", amount: 1.5, unit: "kg", location: "pantry" },
  });
});
it("keeps explicit valid date labels distinct and refuses relative/ambiguous dates", () => {
  expect(describeFood("Add milk in fridge best before 2028-02-29")).toEqual({
    kind: "review",
    draft: {
      name: "milk",
      location: "fridge",
      expires_on: "2028-02-29",
      date_kind: "best_before",
    },
  });
  expect(describeFood("milk use by 2027-02-29")).toMatchObject({
    kind: "manual",
  });
  expect(describeFood("milk use by tomorrow")).toMatchObject({
    kind: "manual",
    reason: "ambiguous",
  });
  expect(describeFood("milk 2027-10-21")).toMatchObject({ kind: "manual" });
  expect(
    describeFood("milk best before 2027-10-21 use by 2027-10-25"),
  ).toMatchObject({ kind: "manual" });
});
it("supports Spanish fields without treating English once as Spanish eleven", () => {
  expect(
    describeFood("Añade dos latas de frijoles a la despensa", "es"),
  ).toEqual({
    kind: "review",
    draft: { name: "frijoles", amount: 2, unit: "latas", location: "pantry" },
  });
  expect(describeFood("leche caduca el 2027-10-21 en la nevera", "es")).toEqual(
    {
      kind: "review",
      draft: {
        name: "leche",
        expires_on: "2027-10-21",
        date_kind: "use_by",
        location: "fridge",
      },
    },
  );
  expect(describeFood("once cooked rice", "en")).toEqual({
    kind: "review",
    draft: { name: "once cooked rice" },
  });
});
it.each([
  "milk, eggs",
  "milk and eggs",
  "leche y huevos",
  "milk\neggs",
  "2",
  "0 milk",
  "-2 milk",
  "100001 eggs",
  "2/3 cup milk",
  "some milk",
  "half a bag rice",
  "twenty cans of beans",
])(
  "does not turn unsupported or multiple descriptions into a stock suggestion: %s",
  (text) => {
    expect(describeFood(text)).toMatchObject({ kind: "manual" });
  },
);
it("bounds text and names without truncating them into different products", () => {
  expect(describeFood("x".repeat(2001))).toEqual({
    kind: "manual",
    reason: "too_long",
  });
  expect(describeFood("x".repeat(201))).toEqual({
    kind: "manual",
    reason: "too_long",
  });
});
