import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Run real shell guard/backup tests with native Git Bash on Windows, never WSL. */
export function runBash(script: string, args: string[], env: Record<string, string>) {
  const testEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: 'test' }
  if (process.platform !== 'win32') {
    return spawnSync('bash', [script, ...args], { env: testEnv, encoding: 'utf8', timeout: 20_000 })
  }
  const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter((root): root is string => Boolean(root))
  const bash = roots.map(root => path.join(root, 'Git', 'bin', 'bash.exe')).find(file => fs.existsSync(file))
  if (!bash) throw new Error('These shell tests need an existing native Git for Windows Bash installation')
  const convert = (value: string) => value.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_, drive: string) => `/${drive.toLowerCase()}/`)
  const entries = (env.PATH || '').split(path.delimiter).filter(Boolean).map(convert)
  // Git tools first after caller-supplied mock executables. Do not change the host PATH.
  const gitRoot = path.dirname(path.dirname(bash))
  const shellEnv = { ...testEnv, SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
    PATH: [entries[0], convert(path.join(gitRoot, 'usr', 'bin')), convert(path.join(gitRoot, 'bin')), ...entries.slice(1)].filter(Boolean).join(':') }
  return spawnSync(bash, ['--noprofile', '--norc', convert(script), ...args.map(convert)], {
    env: shellEnv, encoding: 'utf8', timeout: 20_000,
  })
}
