/** Typed subset shared by direct D1 repositories. Binding lookup is request-scoped. */
export type SqlValue = string | number | null
export interface D1Statement {
  bind(...values: SqlValue[]): D1Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[]; success: boolean; meta: { changes: number } }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
}
export interface D1Store {
  prepare(sql: string): D1Statement
  batch<T>(statements: D1Statement[]): Promise<Array<{ results: T[]; success: boolean; meta: { changes: number } }>>
  withSession(constraint: 'first-primary'): Pick<D1Store, 'prepare' | 'batch'>
}

export async function getD1Database(): Promise<D1Store> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { env } = getCloudflareContext()
  const db = (env as typeof env & { DB?: D1Store }).DB
  if (!db) throw new Error('D1 database binding DB is required')
  return db
}
