import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_UPLOAD_DIR, resolveUploadDir } from '@/lib/upload-dir'

describe('resolveUploadDir', () => {
  it('uses UPLOAD_DIR when set', () => {
    expect(resolveUploadDir({ UPLOAD_DIR: '/srv/uploads' })).toBe('/srv/uploads')
    expect(resolveUploadDir({ UPLOAD_DIR: '  /srv/uploads  ' })).toBe('/srv/uploads')
  })

  it.each([
    ['unset', {}],
    ['empty', { UPLOAD_DIR: '' }],
    ['whitespace', { UPLOAD_DIR: '   ' }],
  ])('falls back to the default when %s', (_label, env) => {
    expect(resolveUploadDir(env)).toBe(DEFAULT_UPLOAD_DIR)
  })

  it('reads process.env by default', () => {
    const before = process.env.UPLOAD_DIR
    try {
      process.env.UPLOAD_DIR = ''
      expect(resolveUploadDir()).toBe(DEFAULT_UPLOAD_DIR)
      process.env.UPLOAD_DIR = '/tmp/fp-uploads'
      expect(resolveUploadDir()).toBe('/tmp/fp-uploads')
    } finally {
      if (before === undefined) delete process.env.UPLOAD_DIR
      else process.env.UPLOAD_DIR = before
    }
  })
})

// Upload, file serving and account deletion must resolve the same directory,
// so nothing outside src/lib/upload-dir.ts may read the variable itself.
describe('UPLOAD_DIR has a single reader', () => {
  const SRC = path.join(__dirname, '../..')

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
    })
  }

  it('only src/lib/upload-dir.ts reads process.env.UPLOAD_DIR', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => /process\.env\.UPLOAD_DIR|process\.env\[['"]UPLOAD_DIR['"]\]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
    expect(readers).toEqual([])
  })
})
