import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && !process.env.SKIP_ENV_VALIDATION) {
      console.warn('WARNING: JWT_SECRET is not set. Authentication will not work properly.')
    }
    return 'dev-secret-change-me'
  }
  return secret
}

const JWT_SECRET = getJwtSecret()

// Dummy hash for timing-safe login (prevents email enumeration)
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lz0Y5y5Zy5ZzOeQz5Zz5Zz5Zz5Zz5Zz5Zz5Zz5Zz5Zy'

export interface TokenPayload {
  userId: string
  email: string
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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload
    if (!decoded.userId || !decoded.email) {
      return null
    }
    return { userId: decoded.userId, email: decoded.email }
  } catch {
    return null
  }
}

// Simple in-memory rate limiter for auth endpoints
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(key: string, maxAttempts = 10, windowMs = 15 * 60 * 1000): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const entry = loginAttempts.get(key)

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0 }
  }

  entry.count++
  if (entry.count > maxAttempts) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  return { allowed: true, retryAfterMs: 0 }
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now()
  loginAttempts.forEach((entry, key) => {
    if (now > entry.resetAt) {
      loginAttempts.delete(key)
    }
  })
}, 60 * 1000)
