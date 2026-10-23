import {
  foodProductLookupConfig,
  foodProductLicenseApproved,
  lookupPublicFoodProduct,
  safeFoodImage,
} from "../food-product-provider";
import { safeFetch } from "../safe-fetch";
jest.mock("../safe-fetch", () => ({ safeFetch: jest.fn() }));
const before = {
  enabled: process.env.FOOD_PRODUCT_LOOKUP_ENABLED,
  approved: process.env.FOOD_PRODUCT_DATA_REUSE_APPROVED,
  contact: process.env.FOOD_PRODUCT_LOOKUP_CONTACT,
};
afterEach(() => {
  for (const [key, value] of Object.entries({
    FOOD_PRODUCT_LOOKUP_ENABLED: before.enabled,
    FOOD_PRODUCT_DATA_REUSE_APPROVED: before.approved,
    FOOD_PRODUCT_LOOKUP_CONTACT: before.contact,
  }))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
  jest.clearAllMocks();
});
it("keeps the provider off without explicit deployment, reuse and contact configuration", async () => {
  delete process.env.FOOD_PRODUCT_LOOKUP_ENABLED;
  delete process.env.FOOD_PRODUCT_DATA_REUSE_APPROVED;
  expect(foodProductLookupConfig()).toBeNull();
  expect(foodProductLicenseApproved()).toBe(false);
  await expect(
    lookupPublicFoodProduct("00036000291452", {
      contact: "fixture@example.invalid",
    }),
  ).rejects.toThrow("disabled");
  expect(safeFetch).not.toHaveBeenCalled();
});
it("requests only bounded fixed-host public metadata and validates returned identity", async () => {
  process.env.FOOD_PRODUCT_LOOKUP_ENABLED = "1";
  process.env.FOOD_PRODUCT_DATA_REUSE_APPROVED = "approved";
  process.env.FOOD_PRODUCT_LOOKUP_CONTACT = "fixture@example.invalid";
  (safeFetch as jest.Mock).mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "success",
        product: {
          code: "0036000291452",
          product_name: "Fixture food",
          brands: "Fixture",
          quantity: "500 g",
          product_type: "food",
          image_front_small_url: "https://evil.example/private",
        },
      }),
      { status: 200 },
    ),
  );
  const result = await lookupPublicFoodProduct("00036000291452", {
    contact: "fixture@example.invalid",
  });
  expect(result).toMatchObject({
    name: "Fixture food",
    package_size: "500 g",
    image_url: null,
  });
  const [url, init] = (safeFetch as jest.Mock).mock.calls[0];
  expect(new URL(url).hostname).toBe("world.openfoodfacts.org");
  expect(init.redirect).toBe("manual");
  expect(init.headers).not.toHaveProperty("Cookie");
  expect(url).not.toContain("family");
  expect(result).not.toHaveProperty("expires_on");
  expect(result).not.toHaveProperty("amount");
});
it("refuses arbitrary image hosts, credentials and unsafe schemes", () => {
  for (const url of [
    "http://images.openfoodfacts.org/a.jpg",
    "https://images.openfoodfacts.org.evil.example/a.jpg",
    "https://user:pass@images.openfoodfacts.org/a.jpg",
  ])
    expect(safeFoodImage(url)).toBeNull();
});
