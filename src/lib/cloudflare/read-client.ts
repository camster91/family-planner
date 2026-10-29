import { getD1Database } from './database'

const READ_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])
export type NativeD1 = Exclude<ConstructorParameters<typeof import('@prisma/adapter-d1').PrismaD1>[0], { CLOUDFLARE_D1_TOKEN: string }>

async function openReadClient(binding: NativeD1) {
  const [{ PrismaClient }, { PrismaD1 }] = await Promise.all([
    import('@/generated/cloudflare-read/client'), import('@prisma/adapter-d1'),
  ])
  // The restricted path uses only prepare/batch on this native primary session.
  // The SDK's broader Database type also includes migration-only exec/dump APIs.
  const adapter = new PrismaD1(binding.withSession('first-primary') as unknown as NativeD1)
  const connect = adapter.connect.bind(adapter)
  adapter.connect = async () => {
    const connection = await connect()
    const queryRaw = connection.queryRaw.bind(connection)
    connection.queryRaw = query => queryRaw({
      ...query,
      // Preserve the app's explicit Unix-millisecond D1 storage convention.
      // The adapter otherwise converts date parameters into ISO text.
      args: query.args.map((arg, index) => {
        if (arg === null || query.argTypes[index]?.scalarType !== 'datetime') return arg
        const value = typeof arg === 'number' ? arg : new Date(arg as string).getTime()
        if (!Number.isSafeInteger(value)) throw new Error('Invalid D1 read date')
        return value
      }),
    })

    // PrismaD1 otherwise treats transactions as independent writes. Refuse
    // before invoking callbacks or allowing an implicit transaction to start.
    connection.startTransaction = async () => { throw new Error('D1 read client does not allow transactions') }
    connection.executeRaw = async () => { throw new Error('D1 read client does not allow writes') }
    return connection
  }
  return new PrismaClient({ adapter }).$extends({
    name: 'HerewovenD1Reads',
    query: {
      $allOperations({ operation, args, query }) {
        if (!READ_OPERATIONS.has(operation)) throw new Error('D1 read client operation refused')
        return query(args)
      },
    },
  })
}

type EngineClient = Awaited<ReturnType<typeof openReadClient>>
type ReadOperation = 'findUnique' | 'findUniqueOrThrow' | 'findFirst' | 'findFirstOrThrow' | 'findMany' | 'count' | 'aggregate' | 'groupBy'
/** No raw SQL, transactions or mutation methods in the caller's type surface. */
export type D1ReadClient = {
  [K in keyof EngineClient as K extends string ? K extends `$${string}` ? never : K : never]:
    Pick<EngineClient[K], Extract<keyof EngineClient[K], ReadOperation>>
}

/** One client per read scope; no I/O instance survives between Worker requests. */
export async function withD1ReadClient<T>(read: (db: D1ReadClient) => Promise<T>, database?: NativeD1): Promise<T> {
  const binding = (database ?? await getD1Database()) as unknown as NativeD1
  const client = await openReadClient(binding)
  // A query extension alone cannot stop an empty batch transaction or a
  // callback invoked before the SDK asks its adapter to start a transaction.
  // Expose only model read methods, enforcing the type boundary at runtime too.
  const readonly = new Proxy(client, {
    get(target, model) {
      if (typeof model !== 'string' || model.startsWith('$')) throw new Error('D1 read client operation refused')
      const delegate = Reflect.get(target, model)
      if (!delegate || typeof delegate !== 'object') throw new Error('D1 read client model refused')
      return new Proxy(delegate, {
        get(target, operation) {
          if (typeof operation !== 'string' || !READ_OPERATIONS.has(operation)) throw new Error('D1 read client operation refused')
          const method = Reflect.get(target, operation)
          if (typeof method !== 'function') throw new Error('D1 read client operation refused')
          return method.bind(target)
        },
      })
    },
  }) as D1ReadClient
  try { return await read(readonly) }
  finally { await client.$disconnect() }
}
