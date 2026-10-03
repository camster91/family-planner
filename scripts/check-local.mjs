// Run repository gates without changing the machine/user PATH or installations.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=process.argv[2] || 'verify:app';
if(!['verify:app','typecheck','lint','test','build'].includes(script))throw new Error('Unsupported local check');
const env={...process.env};
// Local build/generation defaults never point at production data.
env.SKIP_ENV_VALIDATION ??= 'true';
env.DATABASE_URL ??= 'postgresql://placeholder@localhost:5432/placeholder';
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path') || 'PATH';
const seen=new Set();
env[pathKey]=(env[pathKey] || '').split(path.delimiter).filter(entry=>{
 const key=process.platform==='win32'?entry.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase():entry;
 if(!entry||seen.has(key))return false;
 seen.add(key);return true;
}).join(path.delimiter);
if(process.platform==='win32' && env[pathKey].length>7000)throw new Error('Unique child PATH still exceeds the safe CMD budget; no global PATH was changed');
const npmCli=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
if(!fs.existsSync(npmCli))throw new Error('Existing npm CLI not found beside Node; run using the installed Node distribution');
console.log(`Running ${script}; child PATH ${env[pathKey].length} characters; host configuration unchanged`);
const result=spawnSync(process.execPath,[npmCli,'run',script,...(process.argv.length>3?['--',...process.argv.slice(3)]:[])],{cwd:root,env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status ?? 1;
