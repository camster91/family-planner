import {
  todayBoardEnglish,
  todayBoardMessages,
  todayBoardSpanish,
} from "../today-board";

it("keeps the Today/fridge board dictionaries aligned and nonempty", () => {
  expect(Object.keys(todayBoardSpanish).sort()).toEqual(
    Object.keys(todayBoardEnglish).sort(),
  );
  for (const [key, english] of Object.entries(todayBoardEnglish)) {
    const spanish = todayBoardSpanish[key as keyof typeof todayBoardSpanish];
    expect(spanish.trim()).not.toBe("");
    expect((spanish.match(/\{\w+\}/g) || []).sort()).toEqual(
      (english.match(/\{\w+\}/g) || []).sort(),
    );
  }
  expect(todayBoardMessages.en).toBe(todayBoardEnglish);
  expect(todayBoardMessages.es).toBe(todayBoardSpanish);
});
