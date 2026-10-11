import { anniversariesEnglish, anniversariesSpanish } from "../anniversaries";

const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();

it("keeps Anniversaries EN/ES copy keys and placeholders aligned", () => {
  expect(Object.keys(anniversariesSpanish).sort()).toEqual(
    Object.keys(anniversariesEnglish).sort(),
  );

  for (const [key, english] of Object.entries(anniversariesEnglish)) {
    const spanish =
      anniversariesSpanish[key as keyof typeof anniversariesSpanish];
    expect(english.trim()).not.toBe("");
    expect(spanish.trim()).not.toBe("");
    expect(placeholders(spanish)).toEqual(placeholders(english));
  }
});
