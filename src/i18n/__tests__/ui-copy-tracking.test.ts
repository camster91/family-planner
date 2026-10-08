import path from 'node:path'
import fs from 'node:fs'
import { collectUiCopy, summarizeCopy, copyTrackingDifferences, scanUiCopy } from '../../../scripts/ui-copy.cjs'

describe('hard-coded UI copy tracking', () => {
  it('detects display text, accessible/form labels and conditional/template return values', () => {
    const findings = collectUiCopy('screen.tsx', `
      const Screen = () => <>
        <h1> Your household </h1>
        <input aria-label="Email" placeholder="Enter your email" />
        <button title={open ? 'Close details' : 'Open details'}>
          {role === 'parent' ? 'Manage household' : 'Ask a parent'}
        </button>
        <p>{\`You have \${count} waiting tasks\`}</p>
        <p>{busy && 'Saving…'}</p>
      </>
    `)
    expect(findings.map(row => row.text)).toEqual([
      'Your household', 'Email', 'Enter your email', 'Close details', 'Open details',
      'Manage household', 'Ask a parent', 'You have', 'waiting tasks', 'Saving…',
    ])
    expect(findings.every(row => row.line > 1 && row.file === 'screen.tsx')).toBe(true)
  })
  it('ignores translation keys, styles/routes/test IDs, role comparison literals and punctuation', () => {
    const findings = collectUiCopy('screen.tsx', `
      const Screen = () => <div className="card" data-testid="a-test" aria-controls="detail">
        <a href="/dashboard">{t('nav.dashboard')}</a>
        <p>{role === 'parent' ? t('common.save') : t('common.cancel')}</p>
        <span>{' · '}</span><img src="/brand/icon.png" alt="" />
      </div>
    `)
    expect(findings).toEqual([])
  })
  it('rejects new copy, new duplicate occurrences and stale records after a migration', () => {
    const original = collectUiCopy('screen.tsx', '<p>Save</p>')
    const tracked = summarizeCopy(original)
    expect(copyTrackingDifferences(original, tracked)).toEqual([])
    expect(copyTrackingDifferences(collectUiCopy('screen.tsx', '<p>Save</p><p>Save</p>'), tracked)[0]).toContain('2 occurrences')
    expect(copyTrackingDifferences(collectUiCopy('screen.tsx', '<p>Delete</p>'), tracked)).toHaveLength(2)
    expect(copyTrackingDifferences([], tracked)[0]).toContain('stale migration record')
    expect(copyTrackingDifferences(original, [...tracked, ...tracked])[0]).toContain('duplicate migration record')
    expect(copyTrackingDifferences(original, [{ ...tracked[0], count: 0 }])[0]).toContain('invalid migration occurrence count')
  })
  it('production direct JSX copy matches the explicit migration inventory', () => {
    const root = path.resolve(__dirname, '../../..')
    const tracked = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/untranslated-copy.json'), 'utf8'))
    const occurrences = scanUiCopy(root)
    expect(occurrences.length).toBeGreaterThan(0)
    expect(occurrences.some(row => row.file.includes('/__tests__/') || row.file.startsWith('src/app/dev/'))).toBe(false)
    expect(copyTrackingDifferences(occurrences, tracked)).toEqual([])
  })
})
