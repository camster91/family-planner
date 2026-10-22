// Every literal t('…') key used in the UI exists in the English messages, and
// Spanish has exactly the same keys as English.
//
// t() returns the key itself when a message is missing, so a typo or a
// forgotten message shows up as raw text like "wishlist.edit" on screen.
// Only literal string keys are checked; template keys such as
// t(`emergency.relationships.${r}`) are skipped.
import fs from 'fs'
import path from 'path'
import { messages } from '@/i18n'
import { emergencyMessages } from '@/i18n/emergency'
import { routineScheduleMessages } from '@/i18n/routine-schedule'

const SRC = path.join(__dirname, '..', '..')
// These components bind their bare t() to the typed routine translator.
// Keep this explicit: importing the catalog must not exempt unrelated UI.
const ROUTINE_SCOPED_FILES = new Set([
  'IndependentRoutineEditor', 'IndependentRoutineManager',
  'IndependentSavedRequestDetails', 'RoutineSavedRequestDetails',
  'RoutineScheduleEditor', 'RoutineScheduleEntry',
  'RoutineScheduleHandoff', 'RoutineScheduleManager',
].map(name => `components/chores/${name}.tsx`))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function leafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix]
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k)
  )
}

function lookup(obj: unknown, key: string): unknown {
  let value: unknown = obj
  for (const k of key.split('.')) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k]
    } else {
      return undefined
    }
  }
  return value
}

// A bare `t(` call (not `obj.t(`, `set(`, `alert(`) with a literal key.
const T_CALL = /(?<![\w.$])t\(\s*(['"])([A-Za-z0-9_.]+)\1\s*[,)]/g

function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(T_CALL)) {
      const key = match[2]
      const files = used.get(key) ?? []
      files.push(path.relative(SRC, file))
      used.set(key, files)
    }
  }
  return used
}

describe('translation keys', () => {
  it('finds literal t() keys to check', () => {
    expect(usedKeys().size).toBeGreaterThan(50)
  })

  it('every literal t() key used in src exists as an English string', () => {
    const missing = [...usedKeys()]
      .filter(([key, files]) => files.some(file => {
        // Validate scoped keys only where that translator is explicitly bound.
        // Other files still resolve against the global dictionary.
        const routeMessage = file === 'app/dashboard/emergency/page.tsx'
          ? lookup(emergencyMessages.en, key)
          : ROUTINE_SCOPED_FILES.has(file)
            ? lookup(routineScheduleMessages.en, key)
            : undefined
        return typeof routeMessage !== 'string' && typeof lookup(messages.en, key) !== 'string'
      }))
      .map(([key, files]) => `${key} (${[...new Set(files)].join(', ')})`)
    expect(missing).toEqual([])
  })

  it('scoped routine files bind their t() to the routine translator', () => {
    for (const file of ROUTINE_SCOPED_FILES) {
      const text = fs.readFileSync(path.join(SRC, file), 'utf8')
      expect(text).toMatch(/const t = useRoutineScheduleText\(\)/)
      expect(text).not.toMatch(/(?:const|let|var|,)\s*\{[^{}]*\bt\b[^{}]*\}\s*=\s*useTranslation\(/)
    }
  })

  it('Spanish has the same keys as English', () => {
    for (const catalog of [messages, emergencyMessages, routineScheduleMessages]) {
      const en = leafKeys(catalog.en).sort()
      const es = leafKeys(catalog.es).sort()
      expect(es.filter((k) => !en.includes(k))).toEqual([])
      expect(en.filter((k) => !es.includes(k))).toEqual([])
    }
  })
})
