import crypto from 'crypto'

// In-memory reset token store. In production, move this to the database.
const resetTokens = new Map<string, { userId: string; expiresAt: number }>()

export function createResetToken(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 60 * 60 * 1000 // 1 hour
  resetTokens.set(token, { userId, expiresAt })
  return token
}

export function verifyResetToken(token: string): string | null {
  const entry = resetTokens.get(token)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    resetTokens.delete(token)
    return null
  }
  return entry.userId
}

export function deleteResetToken(token: string): void {
  resetTokens.delete(token)
}

// Clean up expired tokens
export function cleanupExpiredTokens(): void {
  const now = Date.now()
  resetTokens.forEach((value, key) => {
    if (value.expiresAt < now) {
      resetTokens.delete(key)
    }
  })
}