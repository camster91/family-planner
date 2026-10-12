import { projectCreateEnglish, projectCreateSpanish } from "../project-create";

it("keeps project create copy keys and interpolation contracts aligned", () => {
  expect(Object.keys(projectCreateSpanish).sort()).toEqual(
    Object.keys(projectCreateEnglish).sort(),
  );

  for (const [key, text] of Object.entries(projectCreateEnglish)) {
    const translated =
      projectCreateSpanish[key as keyof typeof projectCreateEnglish];
    expect(translated.trim()).not.toBe("");
    expect((translated.match(/\{\w+\}/g) || []).sort()).toEqual(
      (text.match(/\{\w+\}/g) || []).sort(),
    );
  }
});
