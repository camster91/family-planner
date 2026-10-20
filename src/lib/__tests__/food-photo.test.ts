import { parseFoodPhotoOutput } from "../inventory-scan";
import { foodPhotoReply, FOOD_PHOTO_PROTOCOL } from "../food-photo-contract";
const label = {
  name: "Fixture beans",
  amount: 500,
  unit: "g",
  location: "pantry",
  confidence: 0.99,
  package_size: "500 g",
  date_text: "Best before 2027-02-28",
  date_candidate: "2027-02-28",
  date_kind: "best_before",
};
it("keeps printed package size separate from stock and rejects overflow dates", () => {
  const good = parseFoodPhotoOutput({ items: [label] }, "package")!;
  expect(good.items[0]).toMatchObject({
    amount: null,
    unit: null,
    package_size: "500 g",
    date_candidate: "2027-02-28",
    date_kind: "best_before",
  });
  const bad = parseFoodPhotoOutput(
    {
      items: [
        {
          ...label,
          date_text: "FEB 31",
          date_candidate: "2027-02-31",
          date_kind: null,
        },
      ],
    },
    "package",
  )!;
  expect(bad.items[0]).toMatchObject({
    date_text: "FEB 31",
    date_candidate: null,
    date_kind: null,
  });
});
it("never turns a receipt timestamp or suggested storage into an expiry/location fact", () => {
  expect(
    parseFoodPhotoOutput({ items: [label] }, "receipt")!.items[0],
  ).toMatchObject({
    date_text: null,
    date_candidate: null,
    date_kind: null,
    location: null,
  });
});
it("reports duplicates/dropped rows without multiplying stock or silently combining quantities", () => {
  const result = parseFoodPhotoOutput(
    { items: [label, label, { amount: 2 }] },
    "receipt",
  )!;
  expect(result.items).toHaveLength(1);
  expect(result.dropped).toBe(2);
});
it("refuses an old fridge response as confirmation of a document mode", () => {
  expect(foodPhotoReply.safeParse({ items: [label], dropped: 0 }).success).toBe(
    false,
  );
  expect(
    foodPhotoReply.safeParse({
      protocol: FOOD_PHOTO_PROTOCOL,
      capture_mode: "package",
      ...parseFoodPhotoOutput({ items: [label] }, "package"),
    }).success,
  ).toBe(true);
});

it.each(["BB FEB 28", "Best before 05/06/2027", "Packed 2027-02-28"])(
  "keeps incomplete, ambiguous or production evidence manual: %s",
  (date_text) => {
    const result = parseFoodPhotoOutput(
      {
        items: [
          {
            ...label,
            date_text,
            date_candidate: date_text.includes("05/06")
              ? "2027-05-06"
              : "2027-02-28",
          },
        ],
      },
      "package",
    )!;
    expect(
      result.items[0].date_candidate === null ||
        result.items[0].date_kind === null,
    ).toBe(true);
  },
);
