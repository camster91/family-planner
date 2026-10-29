import type { D1Store, SqlValue } from './database'
type Session = Pick<D1Store, 'prepare'>
/** Source-owned SQL only. A false/NULL condition aborts the native atomic batch.
 * Successful checks store nothing. No interactive transaction is emulated.
 */
export function d1WriteCheck(db: Session, condition: string, values: SqlValue[] = []) {
  return db.prepare(`INSERT INTO "_D1WriteCheck" (ok) SELECT 0 WHERE NOT COALESCE((${condition}),0)`).bind(...values)
}
export function isD1WriteConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('herewoven_d1_write_precondition')
}
