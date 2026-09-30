'use client'

/**
 * Download the signed-in member's data export (`GET /api/users/export`) as a
 * JSON file. Used by Settings → Data export and offered first in the delete
 * dialog (docs/product/ACCOUNT_DELETION.md "Export").
 */
export async function downloadMyData(now: Date = new Date()): Promise<void> {
  const res = await fetch('/api/users/export', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `family-planner-export-${now.toISOString().slice(0, 10)}.json`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
