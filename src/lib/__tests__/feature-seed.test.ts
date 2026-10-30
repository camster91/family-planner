import {
  escapeFeatureSeedForRsc,
  replaceFeatureSeed,
} from "../../__tests__/helpers/feature-seed";
import { FEATURES, type FamilyFeatures } from "../features";

const ALL_ON: FamilyFeatures = Object.fromEntries(
  FEATURES.map((feature) => [feature.key, true]),
) as FamilyFeatures;

describe("all-on discovery feature seed replacement", () => {
  it("replaces the full raw and escaped feature representations", () => {
    const serialized = JSON.stringify(ALL_ON);
    const escaped = escapeFeatureSeedForRsc(serialized);
    const body = [
      `<script id="family-features" type="application/json">${serialized}</script>`,
      `<script>self.__next_f.push([1,"initialFeatures:${escaped}"])</script>`,
    ].join("");

    const replaced = replaceFeatureSeed(body, ALL_ON);

    expect(replaced).toContain(serialized);
    expect(replaced).toContain(escaped);
    expect(replaced.match(/\\\\"/g)).toBeNull();
    expect(Object.keys(ALL_ON)).toHaveLength(FEATURES.length);
    expect(FEATURES).toHaveLength(23);
  });
});
