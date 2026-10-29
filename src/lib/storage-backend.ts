/** Deployment-wide choice, never request/user input. No fallback on misconfiguration. */
export function storageBackend(): 'postgres' | 'd1' {
  const backend = process.env.HEREWOVEN_STORAGE ?? 'postgres'
  if (backend === 'postgres' || backend === 'd1') return backend
  throw new Error('HEREWOVEN_STORAGE must be postgres or d1')
}
