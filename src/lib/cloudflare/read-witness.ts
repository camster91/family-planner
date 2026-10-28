import { withD1ReadClient, type D1ReadClient, type NativeD1 } from './read-client'
import { d1WriteCheck } from './write-check'
import type { D1Store, SqlValue } from './database'

type Read = { sql: string; values: SqlValue[]; columns: string[]; rows: SqlValue[][] }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
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
                if (args.some(v => v !== null && typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v))))
                  throw new Error('D1 read witness value unsupported')
                return wrap(target.bind(...args), args)
              }
              if (method === 'raw') return async (options: { columnNames?: boolean }) => {
                if (options?.columnNames !== true) throw new Error('D1 read witness requires named columns')
                const result = await target.raw<SqlValue[]>({ columnNames: true })
                const [columns, ...rows] = result as [string[], ...SqlValue[][]]
                if (!columns || new Set(columns).size !== columns.length || columns.some(c => typeof c !== 'string') ||
                  rows.some(row => row.length !== columns.length || row.some(v => v !== null && typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v)))))
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
        : d1WriteCheck(db, `(SELECT json_group_array(json_array(${read.columns.map(quote).join(',')})) FROM (${read.sql}) AS "__witness") IS ?`,
          [...read.values, JSON.stringify(read.rows)]))
    },
    queryCount: reads.length,
  }
}
