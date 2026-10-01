import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function validateReceipts(receipts, env) {
  if (!Array.isArray(receipts) || receipts.length !== 1) throw new Error('One checked runtime receipt is required');
  const r=receipts[0];
  if (!/^[a-f0-9]{40}$/.test(env.RELEASE_SHA || '') || !/^[0-9]+$/.test(env.CHECKED_RUN_ID || '') || !/^[0-9]+$/.test(env.CHECKED_RUN_ATTEMPT || '')) throw new Error('Invalid checked workflow identity');
  if (r?.schema !== 1 || r.repository !== 'camster91/family-planner' || r.kind !== 'runtime' || r.revision !== env.RELEASE_SHA || r.workflow_run_id !== env.CHECKED_RUN_ID || r.workflow_run_attempt !== env.CHECKED_RUN_ATTEMPT) throw new Error('Checked runtime identity differs');
  if (typeof r.image_id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(r.image_id) || typeof r.archive_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.archive_sha256) || typeof r.registry_image !== 'string' || !/^ghcr\.io\/camster91\/family-planner@sha256:[a-f0-9]{64}$/.test(r.registry_image)) throw new Error('Invalid checked image digest');
  return {runtime:r.registry_image};
}

const repository = 'camster91/family-planner';
const assetName = 'family-planner-receipts.json';
const receiptFields = ['schema', 'repository', 'revision', 'kind', 'image_id', 'archive_sha256', 'workflow_run_id', 'workflow_run_attempt', 'registry_image'];
export async function preserve(env, { receipts, fetchImpl = fetch } = {}) {
  // FP_DEFAULT_BRANCH is github.event.repository.default_branch, set by the workflow.
  const defaultBranch = env.FP_DEFAULT_BRANCH || '';
  if (!/^[A-Za-z0-9._/-]+$/.test(defaultBranch) || env.GITHUB_REPOSITORY !== repository || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== `refs/heads/${defaultBranch}` || !env.GITHUB_TOKEN) throw new Error('Only checked default-branch publication can preserve receipts');
  receipts ??= [JSON.parse(await readFile(`${env.CHECKED_IMAGE_DIRECTORY}/release-receipt.json`, 'utf8'))];
  const checked = { RELEASE_SHA: env.RELEASE_SHA, CHECKED_RUN_ID: env.GITHUB_RUN_ID, CHECKED_RUN_ATTEMPT: env.GITHUB_RUN_ATTEMPT };
  const images = validateReceipts(receipts, checked);
  const tag = `family-planner-build-${env.RELEASE_SHA}-run-${env.GITHUB_RUN_ID}-attempt-${env.GITHUB_RUN_ATTEMPT}`;
  const ordered = ['runtime'].map(kind => {
    const receipt = receipts.find(value => value.kind === kind);
    return Object.fromEntries(receiptFields.map(field => [field, receipt[field]]));
  });
  const bytes = Buffer.from(JSON.stringify({ schema: 1, repository, revision: env.RELEASE_SHA, workflowRunId: env.GITHUB_RUN_ID, workflowRunAttempt: env.GITHUB_RUN_ATTEMPT, images, receipts: ordered }, null, 2) + '\n');
  const checksum = value => createHash('sha256').update(value).digest('hex');
  async function request(endpoint, method = 'GET', body) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${endpoint}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('Receipt record API failed: HTTP ' + response.status);
    return response.json();
  }
  function identity(record) {
    if (!Number.isSafeInteger(record?.id) || record.id <= 0 || record.draft !== true || record.tag_name !== tag || record.target_commitish !== env.RELEASE_SHA) throw new Error('Durable draft record identity differs');
  }
  let record;
  for (let page = 1; page <= 100; page++) {
    const records = await request(`/releases?per_page=100&page=${page}`);
    if (!Array.isArray(records)) throw new Error('Unexpected release list');
    record = records.find(value => value.tag_name === tag);
    if (record || records.length < 100) break;
    if (page === 100) throw new Error('Receipt record lookup limit reached');
  }
  if (!record) record = await request('/releases', 'POST', { tag_name: tag, target_commitish: env.RELEASE_SHA, draft: true, prerelease: false, name: `Family Planner checked build ${env.GITHUB_RUN_ID} attempt ${env.GITHUB_RUN_ATTEMPT}`, body: 'Recovery metadata for the tested published runtime image. A draft record does not indicate production deployment.' });
  identity(record);
  const matches = (record.assets || []).filter(asset => asset.name === assetName);
  if (matches.length > 1) throw new Error('Ambiguous durable receipt asset');
  if (!matches.length) {
    const response = await fetchImpl(`https://uploads.github.com/repos/${repository}/releases/${record.id}/assets?name=${assetName}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, 'Content-Type': 'application/json' }, body: bytes });
    if (!response.ok) throw new Error('Durable receipt upload failed: HTTP ' + response.status);
  }
  record = await request('/releases/' + record.id); identity(record);
  const assets = (record.assets || []).filter(asset => asset.name === assetName);
  if (assets.length !== 1 || !Number.isSafeInteger(assets[0].id) || assets[0].id <= 0 || assets[0].size !== bytes.length) throw new Error('Durable receipt upload did not persist');
  let response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/assets/${assets[0].id}`, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/octet-stream' } });
  if (response.status === 302) {
    const url = new URL(response.headers.get('location'));
    if (url.protocol !== 'https:' || url.hostname !== 'release-assets.githubusercontent.com' || url.username || url.password) throw new Error('Unexpected receipt download destination');
    response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  }
  if (!response.ok || checksum(Buffer.from(await response.arrayBuffer())) !== checksum(bytes)) throw new Error('Refetched durable receipts differ');
  return { status: 'verified', releaseId: record.id, tag, sha256: checksum(bytes), draft: true, revision: env.RELEASE_SHA, workflowRunId: env.GITHUB_RUN_ID, workflowRunAttempt: env.GITHUB_RUN_ATTEMPT };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) preserve(process.env).then(value => console.log(JSON.stringify(value))).catch(() => { console.error('Durable Family Planner receipt verification failed'); process.exitCode = 1; });
