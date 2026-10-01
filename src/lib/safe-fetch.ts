// Server-only fetch for user-supplied URLs (AI provider base URLs, ICS feeds).
//
// assertPublicProviderUrl (lib/outbound-url.ts) checks a URL before the call,
// but a plain fetch() resolves the hostname again when it connects. A hostile
// DNS server could answer the check with a public address and the connection
// with a private one (DNS rebinding). This helper closes that gap: the request
// goes through an undici Agent whose connect-time `lookup` resolves the
// hostname, refuses the whole answer if ANY address is private/reserved, and
// hands only the vetted addresses to the socket. The address that was checked
// is the address that is connected to.
//
// IP-literal hosts skip DNS entirely, so they are judged by the same shape
// check (https only, no credentials, no private literals) before the request.
//
// Node-only (undici, node:dns). Import from server code only.

import { lookup as dnsLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { Agent, fetch as undiciFetch } from 'undici'
import { checkProviderUrlShape, isPrivateAddress } from './outbound-url'

export type ResolvedAddress = { address: string; family: number }
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

/** Thrown (as the fetch error's cause) when a host resolves to a refused address. */
export class UnsafeAddressError extends Error {
  readonly code = 'ERR_UNSAFE_ADDRESS'
  constructor(message = 'The address is not a public address') {
    super(message)
    this.name = 'UnsafeAddressError'
  }
}

const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void

/**
 * A `net.connect` compatible lookup that only ever yields public addresses.
 * Any private/reserved address in the answer refuses the whole answer, so a
 * mixed public+private reply cannot be raced into a private connection.
 */
export function createPinnedLookup(resolve: Resolver = systemResolver) {
  return function pinnedLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
    resolve(hostname).then(
      (answers) => {
        if (answers.length === 0 || answers.some((a) => isPrivateAddress(a.address))) {
          callback(new UnsafeAddressError(), '')
          return
        }
        const wanted = options?.family === 4 || options?.family === 6 ? options.family : 0
        const usable = wanted ? answers.filter((a) => a.family === wanted) : answers
        if (usable.length === 0) {
          const err: NodeJS.ErrnoException = new Error(`No address for ${hostname}`)
          err.code = 'ENOTFOUND'
          callback(err, '')
          return
        }
        if (options?.all) callback(null, usable.map((a) => ({ address: a.address, family: a.family })))
        else callback(null, usable[0].address, usable[0].family)
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, '')
    )
  }
}

/** An undici Agent whose every connection goes through the pinned lookup. */
export function createSafeAgent(resolve?: Resolver): Agent {
  return new Agent({ connect: { lookup: createPinnedLookup(resolve) } })
}

let sharedAgent: Agent | null = null
function defaultAgent(): Agent {
  if (!sharedAgent) sharedAgent = createSafeAgent()
  return sharedAgent
}

export interface SafeFetchOptions {
  /** Test seam: an agent built with createSafeAgent(stubResolver). */
  dispatcher?: Agent
}

/**
 * fetch() for a user-supplied https URL with connect-time address pinning.
 * Refuses non-https, credentialed and private-literal URLs up front. Callers
 * keep their own redirect policy (pass `redirect: 'manual'` and re-validate
 * each hop), timeouts and size limits.
 *
 * On a refused address the promise rejects with UnsafeAddressError (unwrapped
 * from undici's generic "fetch failed").
 */
export async function safeFetch(url: string, init: RequestInit = {}, options: SafeFetchOptions = {}): Promise<Response> {
  const shapeError = checkProviderUrlShape(url)
  if (shapeError) throw new UnsafeAddressError(shapeError)
  try {
    const res = await undiciFetch(url, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: options.dispatcher ?? defaultAgent(),
    })
    return res as unknown as Response
  } catch (err) {
    const cause = (err as { cause?: unknown } | null)?.cause
    if (cause instanceof UnsafeAddressError) throw cause
    throw err
  }
}

/** True when an error from safeFetch means the address itself was refused. */
export function isUnsafeAddressError(err: unknown): err is UnsafeAddressError {
  return err instanceof UnsafeAddressError
}
