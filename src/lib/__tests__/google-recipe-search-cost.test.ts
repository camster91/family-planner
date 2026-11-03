import { googleRecipeSearchCost as cost, googleRecipeSearchReservation as reserve, type GoogleRecipeSearchPricing } from "../google-recipe-search-cost";
const pricing: GoogleRecipeSearchPricing = {
  model: "fixture-model", inputMicrousdPerMillion: "1000000",
  outputMicrousdPerMillion: "2000000", searchMicrousdPerUnit: "14000",
  searchBilling: "query",
};
const usage = { inputTokens: 100, outputTokens: 50, searchQueries: 3, grounded: true };
it("adds each search query to token costs without a household free allowance", () => {
  expect(cost(usage, pricing)).toEqual({tokenMicrousd:"200",searchMicrousd:"42000",totalMicrousd:"42200"});
});
it("supports per-grounded-request models without charging once per query", () => {
  expect(cost(usage,{...pricing,searchBilling:"grounded-request"}).totalMicrousd).toBe("14200");
});
it("keeps missing search or token usage unknown while retaining known components", () => {
  expect(cost({...usage,searchQueries:null},pricing)).toEqual({tokenMicrousd:"200",searchMicrousd:null,totalMicrousd:null});
  expect(cost({...usage,inputTokens:null},pricing)).toEqual({tokenMicrousd:null,searchMicrousd:"42000",totalMicrousd:null});
  expect(cost({...usage,grounded:null},{...pricing,searchBilling:"grounded-request"}).totalMicrousd).toBeNull();
});
it("distinguishes reported zero from missing and rounds money upward using integers", () => {
  expect(cost({...usage,searchQueries:0},pricing).totalMicrousd).toBe("200");
  expect(cost({...usage,inputTokens:1,outputTokens:0,searchQueries:0},{...pricing,inputMicrousdPerMillion:"1"}).totalMicrousd).toBe("1");
});
it("reserves searches as well as maximum output without pretending to cap actuals", () => {
  expect(reserve(100,50,3,pricing)).toBe("42200");
  expect(cost({...usage,searchQueries:4},pricing).totalMicrousd).toBe("56200");
  expect(()=>reserve(100,50,0,pricing)).toThrow();
});
it.each([-1,1.5,Infinity,NaN,100000001])("rejects invalid usage %s rather than undercounting", value => {
  expect(()=>cost({...usage,searchQueries:value},pricing)).toThrow();
});
it("rejects fractional or negative prices", () => {
  expect(()=>cost(usage,{...pricing,searchMicrousdPerUnit:"0.5"})).toThrow();
  expect(()=>cost(usage,{...pricing,searchMicrousdPerUnit:"-1"})).toThrow();
});
