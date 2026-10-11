import { FEATURES, type FeatureKey } from "@/lib/features";
import {
  featureDisplayEnglish,
  featureDisplaySpanish,
  getFeatureDisplayCopy,
} from "../feature-display";
import { getFeatureNavTitle } from "../feature-nav";

const registryKeys = FEATURES.map(({ key }) => key).sort();

describe("feature display copy", () => {
  it("covers every registered feature in both locales without changing identity", () => {
    expect(Object.keys(featureDisplayEnglish).sort()).toEqual(registryKeys);
    expect(Object.keys(featureDisplaySpanish).sort()).toEqual(registryKeys);

    for (const key of FEATURES.map(({ key }) => key as FeatureKey)) {
      expect(getFeatureDisplayCopy("en", key).title).toBe(
        FEATURES.find((feature) => feature.key === key)?.title,
      );
      expect(getFeatureDisplayCopy("es", key).title).not.toBe("");
      expect(getFeatureDisplayCopy("es", key).description).not.toBe("");
    }
  });

  it("keeps the shared kid navigation labels aligned with the full catalog", () => {
    for (const locale of ["en", "es"] as const) {
      for (const key of [
        "wishlist",
        "allowance",
        "handoff",
        "sick-days",
        "notes",
      ] as const) {
        expect(getFeatureNavTitle(locale, key)).toBe(
          getFeatureDisplayCopy(locale, key).title,
        );
      }
    }
  });

  it("keeps translated feature search terms distinct from English metadata", () => {
    expect(getFeatureDisplayCopy("es", "inventory")).toEqual({
      title: "Inventario de alimentos",
      description:
        "Controla lo que hay en el frigorífico, congelador y despensa, y qué conviene usar pronto.",
    });
    expect(getFeatureDisplayCopy("es", "travel").title).toBe("Modo viaje");
    expect(getFeatureDisplayCopy("es", "travel").title).not.toBe(
      getFeatureDisplayCopy("en", "travel").title,
    );
  });
});
