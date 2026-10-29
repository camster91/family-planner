import { withD1ReadClient, type D1ReadClient, type NativeD1 } from './read-client'
import { d1WriteCheck } from './write-check'
import type { D1Store, SqlValue } from './database'

type Read = { sql: string; values: SqlValue[]; columns: string[]; rows: SqlValue[][] }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const safeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) &&
  (!Number.isInteger(value) || Number.isSafeInteger(value))
/** SQLite stores Prisma Float values as REAL, so an integral `1.0` can be
 * returned by the SQL witness while the read client exposes JavaScript `1`.
 * Render every numeric SQL value through SQLite's 17-significant-digit
 * round-trip formatter. This keeps exponent/fraction spelling from creating
 * false conflicts while preserving the exact IEEE-754 value. Strings and
 * NULLs are encoded through json_quote/json so their source types stay exact.
 */
const jsonValue = (name: string) => {
  const value = quote(name)
  const numeric = `typeof(${value}) IN ('integer','real')`
  return `json(CASE
    WHEN ${value} IS NULL THEN 'null'
    WHEN ${numeric} AND ${value}=CAST(${value} AS INTEGER) THEN CAST(CAST(${value} AS INTEGER) AS TEXT)
    WHEN ${numeric} THEN printf('%!.17g', CAST(${value} AS REAL))
    ELSE json_quote(${value})
  END)`
}
/** D1 limits SQL functions to 32 arguments. Keep wide canonical rows flat
 * without calling json_array with one argument per field beyond that limit. */
function jsonRow(columns: string[]) {
  let value = `json_array(${columns.slice(0, 32).map(jsonValue).join(',')})`
  for (let offset = 32; offset < columns.length; offset += 15) {
    value = `json_insert(${value},${columns.slice(offset, offset + 15).map(name => `'$[#]',${jsonValue(name)}`).join(',')})`
  }
  return value
}
/** Compare two JSON projections structurally while treating integer/REAL
 * spellings as the same numeric value. `json_tree` keeps array indexes/order,
 * object paths, text-vs-number types, and NULLs explicit. The derived values
 * materialize each side once, so read bind values are not duplicated. */
function witnessJsonEqual(read: Read) {
  const actual = `(SELECT json_group_array(${jsonRow(read.columns)}) FROM (${read.sql}) AS "__witness_rows")`
  const match = (left: string, right: string) => `
    ${left}.fullkey IS ${right}.fullkey AND (
      (${left}.type IN ('integer','real') AND ${right}.type IN ('integer','real')
        AND printf('%!.17g', CAST(${left}.atom AS REAL)) IS printf('%!.17g', CAST(${right}.atom AS REAL)))
      OR (${left}.type=${right}.type AND ${left}.type NOT IN ('integer','real') AND ${left}.atom IS ${right}.atom)
    )`
  return `(SELECT CASE WHEN __actual.value IS __expected.value THEN 1 ELSE (
    NOT EXISTS (
      SELECT 1 FROM json_tree(__actual.value) AS actual
      WHERE NOT EXISTS (
        SELECT 1 FROM json_tree(__expected.value) AS expected
        WHERE ${match('actual', 'expected')}
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_tree(__expected.value) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM json_tree(__actual.value) AS actual
        WHERE ${match('expected', 'actual')}
      )
    )
  ) END FROM (SELECT ${actual} AS value) AS __actual
  CROSS JOIN (SELECT ? AS value) AS __expected)`
}
/** Capture exactly the native SQL/results used by a source-owned read loader.
 * The callback still receives only the enforced read facade. No client/model
 * SQL is accepted. Repeating these reads as assertions inside the effect batch
 * proves that its projection could have been read at the commit boundary.
 * Includes empty sets, ordering, limited windows and nested dependency reads.
 * This is optimistic validation, never an emulated interactive transaction.
 */
export async function captureD1Reads<T>(read: (client: D1ReadClient) => Promise<T>, database: NativeD1) {
  const reads: Read[] = []
  let bytes = 0
  const primary = database.withSession('first-primary')
  const binding = new Proxy(database, {
    get(target, property) {
      if (property !== 'withSession') {
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return () => ({
        prepare(sql: string) {
          if (!/^SELECT\s/i.test(sql) || sql.includes(';')) throw new Error('D1 read witness requires a single source-owned SELECT')
          const wrap = (statement: ReturnType<typeof primary.prepare>, values: SqlValue[]): ReturnType<typeof primary.prepare> => new Proxy(statement, {
            get(target, method) {
              if (method === 'bind') return (...args: SqlValue[]) => {
                if (args.some(v => v !== null && typeof v !== 'string' && !safeNumber(v)))
                  throw new Error('D1 read witness value unsupported')
                return wrap(target.bind(...args), args)
              }
              if (method === 'raw') return async (options: { columnNames?: boolean }) => {
                if (options?.columnNames !== true) throw new Error('D1 read witness requires named columns')
                const result = await target.raw<SqlValue[]>({ columnNames: true })
                const [columns, ...rows] = result as [string[], ...SqlValue[][]]
                if (!columns || new Set(columns).size !== columns.length || columns.some(c => typeof c !== 'string') ||
                  rows.some(row => row.length !== columns.length || row.some(v => v !== null && typeof v !== 'string' && !safeNumber(v))))
                  throw new Error('D1 read witness result unsupported')
                bytes += new TextEncoder().encode(JSON.stringify([sql, values, columns, rows])).length
                if (reads.length >= 256 || bytes > 1_048_576 || values.length > 98 || columns.length > 100)
                  throw new Error('D1 read witness exceeds bounded context')
                // The adapter may normalize/mutate its result arrays afterwards.
                reads.push({ sql, values: [...values], columns: [...columns], rows: rows.map(row => [...row]) })
                return result
              }
              throw new Error('D1 read witness operation refused')
            },
          })
          return wrap(primary.prepare(sql), [])
        },
      })
    },
  })
  const value = await withD1ReadClient(read, binding)
  return {
    value,
    checks(db: Pick<D1Store, 'prepare'>) {
      if (reads.length === 0) throw new Error('D1 read witness is empty')
      return reads.map(read => read.rows.length === 0
        ? d1WriteCheck(db, `NOT EXISTS (${read.sql})`, read.values)
        : d1WriteCheck(db, `${witnessJsonEqual(read)} IS 1`,
          [...read.values, JSON.stringify(read.rows)]))
    },
    queryCount: reads.length,
  }
}
