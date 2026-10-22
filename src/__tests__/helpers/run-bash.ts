import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Run real shell guard/backup tests with native Git Bash on Windows, never WSL. */
export function runBash(script: string, args: string[], env: Record<string, string> & Pick<NodeJS.ProcessEnv, 'NODE_ENV'>) {
  // Preserve explicit production markers: negative guard tests must refuse them.
  const testEnv: NodeJS.ProcessEnv = { ...env }
  if (process.platform !== 'win32') {
    // The repository scripts use Bash 4+ (mapfile, associative arrays and
    // lowercase expansion). macOS /bin/bash is 3.2; use an existing modern
    // installation without installing packages or changing the host PATH.
    const bash = process.platform === 'darwin'
      ? ['/opt/homebrew/bin/bash', '/usr/local/bin/bash'].find(file => fs.existsSync(file))
      : 'bash'
    if (!bash) throw new Error('These shell tests need an existing Bash 4+ installation on macOS')
    if (process.platform !== 'darwin') {
      return spawnSync(bash, [script, ...args], { env: testEnv, encoding: 'utf8', timeout: 20_000 })
    }
    // Nested `bash` calls need the same runtime. A bash-only shim preserves
    // caller mock commands (notably docker) rather than prepending Homebrew's
    // entire bin directory ahead of them.
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-bash-'))
    try {
      fs.symlinkSync(bash, path.join(shim, 'bash'))
      return spawnSync(bash, [script, ...args], {
        env: { ...testEnv, PATH: `${shim}${path.delimiter}${testEnv.PATH ?? '/usr/bin:/bin'}` },
        encoding: 'utf8', timeout: 20_000,
      })
    } finally {
      fs.rmSync(shim, { recursive: true, force: true })
    }
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
