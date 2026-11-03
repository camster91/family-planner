import { createD1AiUsageJob } from "../cloudflare/ai-usage";
import type { D1Store } from "../cloudflare/database";
jest.mock('../capture',()=>({resolveCaptureConfig:()=>({model:'fixture',baseUrl:'https://example.invalid',apiKey:'fixture',userSuppliedUrl:false})}));
jest.mock('../ai-usage-hash',()=>({aiConfigHash:()=> 'fixture-hash'}));
jest.mock('../ai-usage-gates',()=>({isAiUsageAdopted:()=>true,isAiUsageReady:()=>true}));
const config={model:'fixture',baseUrl:'https://example.invalid',apiKey:'fixture',userSuppliedUrl:false};
const pricing={model:'fixture',inputMicrousdPerMillion:'1000000',outputMicrousdPerMillion:'2000000',searchMicrousdPerUnit:'14000',searchBilling:'query' as const};
const actor={userId:'fixture-user',familyId:'fixture-family',generation:0,role:'parent'};
function fixture(){
 const writes:Array<{sql:string,args:unknown[]}>=[];
 const db={withSession:()=>db,prepare:(sql:string)=>{
 let args:unknown[]=[];
 const stmt={bind:(...values:unknown[])=>{args=values;return stmt;},first:async()=>{
 if(sql.includes('sqlite_master'))return {count:2};
 if(sql.includes('INSERT INTO')){writes.push({sql,args});return {id:'fixture-request'};}
 if(sql.includes('FROM "AiUsagePolicy"'))return {revision:1,enabled:1,daily_limit:100,user_daily_limit:40,monthly_budget_microusd:1000000,input_rate:1000000,output_rate:2000000,priced_config_hash:'fixture-hash'};
 if(sql.includes('FROM "Family"'))return {capture_ai_key_enc:null,capture_ai_base_url:null,capture_ai_model:'fixture'};
 throw Error('Unexpected query');
 },run:async()=>{writes.push({sql,args});return {success:true};}};return stmt;
 }};
 return {db:db as unknown as D1Store,writes};
}
it.each([4,null])('writes search-inclusive reserve and actual/unknown settlement (%s)',async searchQueries=>{
 const {db,writes}=fixture();const job=createD1AiUsageJob(db,actor,config,'assistant')!;
 await job.observer.start({inputBytes:100,maxOutputTokens:50,search:{pricing,queryAllowance:3}});
 expect(writes.find(w=>w.sql.includes('INSERT INTO'))?.args[7]).toBe(43224);
 job.observer.reported({inputTokens:100,outputTokens:50,searchQueries,grounded:true});
 await job.finish(200);await job.finish(200);
 const updates=writes.filter(w=>w.sql.includes('UPDATE "AiUsageRequest"'));
 expect(updates).toHaveLength(1);expect(updates[0].args[6]).toBe(searchQueries===null?null:56200);
 expect(updates[0].args[8]).toBe(actor.familyId);
 expect(updates[0].sql).not.toContain('reserved_microusd=');
});
it('refuses unpriced search before reserving or dispatching',async()=>{
 const {db,writes}=fixture();const job=createD1AiUsageJob(db,actor,config,'assistant')!;
 await expect(job.observer.start({inputBytes:100,maxOutputTokens:50,search:{pricing:{...pricing,model:'other'},queryAllowance:3}})).rejects.toThrow();
 expect(writes).toHaveLength(0);
});
