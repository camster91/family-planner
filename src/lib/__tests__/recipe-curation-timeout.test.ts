import { requestRecipeCurationJson } from '../recipe-curation-client';
const originalFetch=global.fetch;
beforeEach(()=>jest.useFakeTimers());afterEach(()=>{jest.useRealTimers();global.fetch=originalFetch;});
it('allows a discovery reply after the ordinary 15-second deadline',async()=>{
 global.fetch=jest.fn(()=>new Promise(resolve=>setTimeout(()=>resolve(new Response('{"results":[]}')),20000))) as typeof fetch;
 const result=requestRecipeCurationJson('/api/recipes/discover',{},1024,{timeoutMs:45000});
 await jest.advanceTimersByTimeAsync(20000);
 expect(await result).toMatchObject({kind:'reply',body:{results:[]}});
});
it('keeps default requests bounded at 15 seconds and discovery bounded at 45',async()=>{
 global.fetch=jest.fn(()=>new Promise(()=>{})) as typeof fetch;
 const ordinary=requestRecipeCurationJson('/api/recipes/preview',{},1024);
 const discovery=requestRecipeCurationJson('/api/recipes/discover',{},1024,{timeoutMs:45000});
 let ended=false;void discovery.then(()=>{ended=true});
 await jest.advanceTimersByTimeAsync(15000);expect(await ordinary).toEqual({kind:'unknown'});expect(ended).toBe(false);
 await jest.advanceTimersByTimeAsync(30000);expect(await discovery).toEqual({kind:'unknown'});
});
it('still cancels discovery immediately when its owning sheet closes',async()=>{
 global.fetch=jest.fn(()=>new Promise(()=>{})) as typeof fetch;
 const abort=new AbortController();const result=requestRecipeCurationJson('/api/recipes/discover',{signal:abort.signal},1024,{timeoutMs:45000});
 await jest.advanceTimersByTimeAsync(1);abort.abort();expect(await result).toEqual({kind:'unknown'});
});
