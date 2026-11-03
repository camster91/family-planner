import { searchGoogleRecipes } from "../google-recipe-search";
import { parseGoogleRecipeDiscovery, readGoogleRecipeUsage } from "../google-recipe-search-response";
const config={baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai",model:"gemini-3.8-flash",apiKey:"fixture-secret",userSuppliedUrl:false};
const pricing={model:config.model,inputMicrousdPerMillion:"1000000",outputMicrousdPerMillion:"2000000",searchMicrousdPerUnit:"14000",searchBilling:"query" as const};
function reply(){return {status:"completed",usage:{total_input_tokens:10,total_output_tokens:20,total_thought_tokens:30},steps:[
 {type:"thought",signature:"PRIVATE_SIGNATURE",summary:[{text:"PRIVATE_THOUGHT"}]},
 {type:"google_search_call",arguments:{queries:["soup","soup"]}},
 {type:"google_search_result",result:[{search_suggestions:'<div>Google search suggestions</div>'}]},
 {type:"model_output",content:[{type:"text",text:"Try soup.",annotations:[{type:"url_citation",url:"https://example.com/recipe",title:"Soup",start_index:0,end_index:9}]}]},
]};}
const oldFetch=global.fetch, oldReady=process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY, oldPaused=process.env.FAMILY_AI_PROVIDER_DISABLED;
beforeEach(()=>{process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY="1";delete process.env.FAMILY_AI_PROVIDER_DISABLED;global.fetch=jest.fn(async()=>new Response(JSON.stringify(reply()),{status:200}));});
afterAll(()=>{global.fetch=oldFetch;if(oldReady===undefined)delete process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY;else process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY=oldReady;if(oldPaused===undefined)delete process.env.FAMILY_AI_PROVIDER_DISABLED;else process.env.FAMILY_AI_PROVIDER_DISABLED=oldPaused;});
const meter=()=>({start:jest.fn(async()=>{}),reported:jest.fn(),failed:jest.fn()});
it("preserves cited output and suggestion HTML without thought/query leakage",()=>{
 const result=parseGoogleRecipeDiscovery(reply());expect(result.blocks[0].annotations[0].url).toBe("https://example.com/recipe");expect(result.suggestions).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('PRIVATE_');expect(result).not.toHaveProperty('queries');
});
it("counts repeated executed queries and output plus thought tokens",()=>{expect(readGoogleRecipeUsage(reply())).toEqual({inputTokens:10,outputTokens:50,searchQueries:2,grounded:true});});
it("leaves missing thought and malformed search usage unknown",()=>{
 const r=reply();delete (r.usage as Partial<typeof r.usage>).total_thought_tokens;
 delete r.steps[1].arguments;expect(readGoogleRecipeUsage(r)).toMatchObject({outputTokens:null,searchQueries:null});
});
it.each(['javascript:alert(1)','http://example.com','https://user:pass@example.com'])('rejects unsafe citation %s',url=>{
 const r=reply();r.steps[3].content![0].annotations[0].url=url;expect(()=>parseGoogleRecipeDiscovery(r)).toThrow();
});
it("rejects missing attribution, incomplete responses and invalid citation offsets",()=>{
 expect(()=>parseGoogleRecipeDiscovery({...reply(),status:'incomplete'})).toThrow();
 const r=reply();r.steps.splice(2,1);expect(()=>parseGoogleRecipeDiscovery(r)).toThrow();
 const bad=reply();bad.steps[3].content![0].annotations[0].end_index=100;expect(()=>parseGoogleRecipeDiscovery(bad)).toThrow();
});
it("reserves before one fixed-host call, disables storage and reports usage",async()=>{
 const observer=meter();await searchGoogleRecipes('soup',config,pricing,observer);
 expect(observer.start.mock.invocationCallOrder[0]).toBeLessThan((global.fetch as jest.Mock).mock.invocationCallOrder[0]);
 expect(global.fetch).toHaveBeenCalledTimes(1);
 const [url,init]=(global.fetch as jest.Mock).mock.calls[0];expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');expect(init.redirect).toBe('manual');expect(JSON.parse(init.body)).toMatchObject({store:false,stream:false});expect(observer.reported).toHaveBeenCalledWith({inputTokens:10,outputTokens:50,searchQueries:2,grounded:true});
});
it("does not dispatch when disabled, misconfigured or denied by the meter",async()=>{
 const observer=meter();process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY='0';await expect(searchGoogleRecipes('soup',config,pricing,observer)).rejects.toThrow();process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY='1';await expect(searchGoogleRecipes('soup',{...config,baseUrl:'https://example.com'},pricing,observer)).rejects.toThrow();observer.start.mockRejectedValueOnce(new Error('limit'));await expect(searchGoogleRecipes('soup',config,pricing,observer)).rejects.toThrow('limit');expect(global.fetch).not.toHaveBeenCalled();
});
it("does not retry errors or expose provider error text",async()=>{
 global.fetch=jest.fn(async()=>new Response('PRIVATE_PROVIDER_ECHO',{status:429}));const observer=meter();await expect(searchGoogleRecipes('soup',config,pricing,observer)).rejects.toThrow('Google recipe search unavailable');expect(global.fetch).toHaveBeenCalledTimes(1);expect(observer.failed).toHaveBeenCalledWith('error');
});
it("accounts for usage even when grounded display is invalid",async()=>{
 const r=reply();r.steps.splice(2,1);global.fetch=jest.fn(async()=>new Response(JSON.stringify(r)));const observer=meter();await expect(searchGoogleRecipes('soup',config,pricing,observer)).rejects.toThrow();expect(observer.reported).toHaveBeenCalled();
});

it("does not treat absent completed steps as free searches",()=>{expect(readGoogleRecipeUsage({status:"completed",steps:[]})).toMatchObject({searchQueries:null,grounded:null});});

it("rejects per-request search pricing for a query-priced model",async()=>{await expect(searchGoogleRecipes("soup",config,{...pricing,searchBilling:"grounded-request"},meter())).rejects.toThrow("configuration");expect(global.fetch).not.toHaveBeenCalled();});
