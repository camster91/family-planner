import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

let _jwtSecret: string | null = null

function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret

  const secret = process.env.JWT_SECRET
  if (secret) {
    _jwtSecret = secret
    return secret
  }

  // Allow build-time to bypass JWT_SECRET requirement
  // (Next.js collects page data during build; JWT_SECRET isn't available yet)
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    _jwtSecret = 'BUILD_TIME_TEMPORARY_SECRET'
    return _jwtSecret
  }

  // Production must have a real secret — hard fail
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CRITICAL: JWT_SECRET environment variable is not set. ' +
      'Authentication cannot work without a secure secret. ' +
      'Set JWT_SECRET in your deployment environment.'
    )
  }

  // Development-only fallback
  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      'WARNING: JWT_SECRET not set. Using dev fallback. ' +
      'DO NOT use in production.'
    )
  }
  _jwtSecret = 'dev-secret-change-me-DO-NOT-USE-IN-PRODUCTION'
  return _jwtSecret
}

// Dummy hash for timing-safe login (prevents email enumeration)
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lz0Y5y5Zy5ZzOeQz5Zz5Zz5Zz5Zz5Zz5Zz5Zz5Zz5Zy'

export interface TokenPayload {
  userId: string
  email: string
  /** Family role. Optional for backward compat with tokens issued before 2026-06-06. */
  role?: string
  /** Family ID. Optional for the same reason. */
  family_id?: string | null
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Always run bcrypt.compare even for non-existent users to prevent timing attacks.
 */
export async function safeVerifyPassword(password: string, hash: string | null): Promise<boolean> {
  return bcrypt.compare(password, hash || DUMMY_HASH)
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload
    if (!decoded.userId || !decoded.email) {
      return null
    }
    // role + family_id are optional (older tokens don't have them). Routes that
    // need them must fall back to a DB lookup (use authenticateWithFamily, not
    // getServerUser) or treat them as 'parent' for legacy tokens.
    return {
      userId: decoded.userId as string,
      email: decoded.email as string,
      role: (decoded as any).role,
      family_id: (decoded as any).family_id ?? null,
    }
  } catch {
    return null
  }
}

// Rate limiting moved to src/lib/rate-limit-db.ts (Postgres-backed).
// Kept here as a stub to avoid breaking any imports during migration.
export function checkRateLimit(key: string, maxAttempts = 10, windowMs = 15 * 60 * 1000): { allowed: boolean; retryAfterMs: number } {
  console.warn('checkRateLimit called from old in-memory implementation. Use rate-limit-db instead.')
  return { allowed: true, retryAfterMs: 0 }
}
