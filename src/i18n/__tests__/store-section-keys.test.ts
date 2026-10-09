import {
  GROCERY_SECTIONS,
  GROCERY_SECTION_LABELS,
} from "@/lib/grocery-sections";
import { storeSectionsEnglish, storeSectionsSpanish } from "../store-sections";

it("covers the same typed keys in both languages and preserves canonical IDs/default English labels", () => {
  expect(Object.keys(storeSectionsSpanish).sort()).toEqual(
    Object.keys(storeSectionsEnglish).sort(),
  );
  expect(
    Object.fromEntries(
      GROCERY_SECTIONS.map((id) => [id, storeSectionsEnglish[id]]),
    ),
  ).toEqual(GROCERY_SECTION_LABELS);
  for (const dictionary of [storeSectionsEnglish, storeSectionsSpanish]) {
    for (const id of GROCERY_SECTIONS)
      expect(dictionary[id].trim()).not.toBe("");
    for (const key of ["moveItem", "moveTitle"] as const)
      expect(dictionary[key].match(/\{item\}/g)).toHaveLength(1);
  }
});
