import { reserveProviderCost, settleProviderCost } from "../ai-search-metering";
import { defaultAiUsagePolicy } from "../ai-usage-contract";
const pricing = { model:"fixture",inputMicrousdPerMillion:"1000000",outputMicrousdPerMillion:"2000000",searchMicrousdPerUnit:"14000",searchBilling:"query" as const };
const policy = {...defaultAiUsagePolicy,monthlyBudgetMicrousd:"1000000",inputRateMicrousdPerMillion:"1000000",outputRateMicrousdPerMillion:"2000000"};
const input = {inputBytes:100,maxOutputTokens:50,search:{pricing,queryAllowance:3}};
it("includes search cost in admission and preserves a frozen pricing snapshot",()=>{
 const result=reserveProviderCost(input,policy,"fixture");expect(result.reserved).toBe("43224");expect(Object.isFrozen(result.searchPricing)).toBe(true);expect(result.searchPricing).not.toBe(pricing);
});
it("requires matching model, current token rates and an explicit budget",()=>{
 expect(()=>reserveProviderCost(input,policy,"other")).toThrow();
 expect(()=>reserveProviderCost(input,{...policy,monthlyBudgetMicrousd:null},"fixture")).toThrow();
 expect(()=>reserveProviderCost(input,{...policy,inputRateMicrousdPerMillion:null},"fixture")).toThrow();
 expect(()=>reserveProviderCost(input,{...policy,outputRateMicrousdPerMillion:"1"},"fixture")).toThrow();
});
it("settles actual searches and retains unknown outcomes instead of token-only costs",()=>{
 const usage={inputTokens:100,outputTokens:50,searchQueries:4,grounded:true};
 expect(settleProviderCost(usage,policy,pricing)).toBe("56200");
 expect(settleProviderCost({...usage,searchQueries:null},policy,pricing)).toBeNull();
 expect(settleProviderCost({...usage,searchQueries:Infinity},policy,pricing)).toBeNull();
 expect(settleProviderCost(usage,policy,null)).toBe("200");
});
it("leaves ordinary provider reservations unchanged",()=>{
 expect(reserveProviderCost({inputBytes:100,maxOutputTokens:50},policy,"fixture")).toEqual({reserved:"1224",searchPricing:null});
});
