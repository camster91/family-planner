import { normalizeFoodBarcode, validGtin } from "../food-barcode";
describe("reviewed retail barcode identity", () => {
  it("preserves leading zero identity across UPC-A, EAN-13 and GTIN-14", () => {
    expect(normalizeFoodBarcode("0 36000 29145 2")?.gtin).toBe(
      "00036000291452",
    );
    expect(normalizeFoodBarcode("0036000291452")?.gtin).toBe("00036000291452");
    expect(normalizeFoodBarcode("00036000291452")?.gtin).toBe("00036000291452");
  });
  it("requires an explicit eight-digit format and expands a full UPC-E before checking its digit", () => {
    expect(normalizeFoodBarcode("04252614")).toBeNull();
    expect(normalizeFoodBarcode("04252614", "upc_e")?.gtin).toBe(
      "00042100005264",
    );
    expect(normalizeFoodBarcode("96385074", "ean_8")?.gtin).toBe(
      "00000096385074",
    );
    expect(normalizeFoodBarcode("01234558", "upc_e")?.gtin).toBe(
      "00012345000058",
    );
  });
  it.each([
    "036000291453",
    "00000000000000",
    "https://example.test/code",
    "425261",
    "1234567",
    "03600029145x",
  ])("refuses invalid/ambiguous input %s", (code) => {
    expect(normalizeFoodBarcode(code)).toBeNull();
  });
  it("marks local/variable codes for manual review rather than decoding weight or dates", () => {
    const code = normalizeFoodBarcode("200000000004");
    expect(code?.restricted).toBe(true);
    expect(code).not.toHaveProperty("amount");
    expect(code).not.toHaveProperty("expires_on");
    expect(validGtin("96385074")).toBe(true);
  });
});
