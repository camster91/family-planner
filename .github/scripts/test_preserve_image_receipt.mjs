import test from 'node:test';
import assert from 'node:assert/strict';
import { preserve } from './preserve-image-receipt.mjs';
function fixture() {
  const env = { RELEASE_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: 'camster91/family-planner', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_TOKEN: 'test-secret' };
  const receipts = ['runtime'].map((kind, index) => ({ schema: 1, repository: env.GITHUB_REPOSITORY, revision: env.RELEASE_SHA, kind, image_id: 'sha256:' + 'b'.repeat(64), archive_sha256: 'c'.repeat(64), workflow_run_id: '123', workflow_run_attempt: '2', registry_image: `ghcr.io/camster91/family-planner@sha256:${'d'.repeat(64)}`, privateExtra: 'must-not-be-recorded' }));
  const tag = `family-planner-build-${env.RELEASE_SHA}-run-123-attempt-2`, calls = [];
  let record, bytes;
  const fetchImpl = async (url, options = {}) => {
    url = new URL(url); calls.push({ url: url.href, ...options });
    const reply = value => new Response(JSON.stringify(value));
    if (url.hostname === 'uploads.github.com') { bytes = Buffer.from(options.body); assert.equal(bytes.includes('must-not-be-recorded'), false); record.assets = [{ id: 2, name: 'family-planner-receipts.json', size: bytes.length }]; return reply(record.assets[0]); }
    if (url.pathname.endsWith('/releases/assets/2')) return new Response(bytes);
    if (options.method === 'POST') { record = { ...JSON.parse(options.body), id: 1, assets: [] }; return reply(record); }
    if (url.search) return reply(record ? [record] : []);
    return reply(record);
  };
  return { env, receipts, tag, calls, fetchImpl, options: { receipts, fetchImpl }, setRecord(value) { record = value; }, corrupt() { bytes[0] ^= 1; } };
}
test('the checked main receipt is recorded as a draft and refetched byte-identical', async () => {
  const f = fixture(), result = await preserve(f.env, f.options); assert.equal(result.draft, true); assert.equal(result.tag, f.tag); assert.equal(result.releaseId, 1);
  const posts = f.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 2); assert.equal(JSON.parse(posts[0].body).draft, true);
});
test('invalid image fields and ambiguous receipt sets cannot make remote requests', async () => {
  for (const [key, value] of [['registry_image','ghcr.io/foreign/app@sha256:'+'d'.repeat(64)],['kind','role-init'],['image_id','sha256:bad'],['archive_sha256',{}],['schema',2]]) {
    const f=fixture(); f.receipts[0][key]=value; await assert.rejects(preserve(f.env,f.options)); assert.equal(f.calls.length,0);
  }
  for (const count of [0,2]) {
    const f=fixture(); f.options.receipts=count===0?[]:[...f.receipts,...f.receipts]; await assert.rejects(preserve(f.env,f.options)); assert.equal(f.calls.length,0);
  }
});
test('idempotent retries verify the existing asset without overwriting it', async () => {
  const f = fixture(), first = await preserve(f.env, f.options); f.calls.length = 0; const second = await preserve(f.env, f.options); assert.deepEqual(first, second); assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});
test('wrong event, repository or build attempt cannot make any remote request', async () => {
  for (const [key, value] of [['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REF', 'refs/heads/master'], ['GITHUB_REPOSITORY', 'foreign/repo'], ['GITHUB_RUN_ATTEMPT', '3']]) { const f = fixture(); f.env[key] = value; await assert.rejects(preserve(f.env, f.options)); assert.equal(f.calls.length, 0); }
});
test('conflicting draft identity and modified existing asset are rejected without overwriting', async () => {
  const f = fixture(); f.setRecord({ id: 1, draft: false, tag_name: f.tag, target_commitish: f.env.RELEASE_SHA, assets: [] }); await assert.rejects(preserve(f.env, f.options), /identity/); assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  const valid = fixture(); await preserve(valid.env, valid.options); valid.corrupt(); valid.calls.length = 0; await assert.rejects(preserve(valid.env, valid.options), /differ/); assert.equal(valid.calls.filter(call => call.method === 'POST').length, 0);
});
test('asset redirects never send the GitHub credential to the download host', async () => {
  const f = fixture(), actual = f.fetchImpl; let source;
  f.options.fetchImpl = async (url, options = {}) => {
    if (String(url).includes('/releases/assets/2')) { source = await actual(url, options); return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/file' } }); }
    if (String(url).startsWith('https://release-assets.githubusercontent.com')) { assert.equal(options.headers?.Authorization, undefined); return source; }
    return actual(url, options);
  };
  assert.equal((await preserve(f.env, f.options)).status, 'verified');
});
test('redirects to untrusted origins are rejected', async () => {
  const f = fixture(), actual = f.fetchImpl;
  f.options.fetchImpl = (url, options) => String(url).includes('/releases/assets/2') ? Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://foreign.example/file' } })) : actual(url, options);
  await assert.rejects(preserve(f.env, f.options), /destination/);
});
