import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

let _jwtSecret: string | null = null

function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret

  const secret = process.env.JWT_SECRET
  const isNextBuild =
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.npm_lifecycle_event === 'build'
  if (secret) {
    if (
      process.env.NODE_ENV === 'production' &&
      !isNextBuild &&
      secret.length < 32
    ) {
      throw new Error(
        'CRITICAL: JWT_SECRET must be at least 32 characters in production.'
      )
    }
    _jwtSecret = secret
    return secret
  }

  // next build may evaluate this module without runtime secrets.
  if (isNextBuild) {
    _jwtSecret = 'BUILD_TIME_TEMPORARY_SECRET'
    return _jwtSecret
  }

  // Production runtime must have a real secret — including when
  // SKIP_ENV_VALIDATION is set for build-time validation only.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CRITICAL: JWT_SECRET environment variable is not set. ' +
      'Authentication cannot work without a secure secret. ' +
      'Set JWT_SECRET in your deployment environment.'
    )
  }

  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    _jwtSecret = 'BUILD_TIME_TEMPORARY_SECRET'
    return _jwtSecret
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
  /**
   * Session generation, mirrored from `User.token_version` at signing time.
   * A password reset/change increments the DB column, which makes every JWT
   * carrying an older `tv` fail authentication. Tokens issued before this claim
   * existed are treated as generation 0, which matches the column default — so
   * deploying this does not sign existing sessions out.
   */
  tv?: number
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
    // role + family_id are optional (older tokens don't have them) and are
    // NOT authoritative: `verifySessionToken` (src/lib/session.ts) replaces
    // both with the database values on every request (D6, #102). Only code
    // that calls verifyToken directly sees the claims, and it must not use
    // them for authorization.
    return {
      userId: decoded.userId as string,
      email: decoded.email as string,
      role: (decoded as any).role,
      family_id: (decoded as any).family_id ?? null,
      // Absent on tokens minted before the tv claim existed — generation 0.
      tv: typeof (decoded as any).tv === 'number' ? (decoded as any).tv : 0,
    }
  } catch {
    return null
  }
}

export function checkRateLimit(
  _key: string,
  _maxAttempts = 10,
  _windowMs = 15 * 60 * 1000
): { allowed: boolean; retryAfterMs: number } {
  throw new Error(
    'checkRateLimit from @/lib/auth is removed. Import checkRateLimit from @/lib/rate-limit-db.'
  )
}
