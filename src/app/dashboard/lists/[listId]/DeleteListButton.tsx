'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

export default function DeleteListButton({ listId, listName }: { listId: string; listName: string }) {
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm(`Delete "${listName}"?`)) return
    setDeleting(true)
    try {
      // Get CSRF token from cookie
      const csrfMatch = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))
      const csrf = csrfMatch ? csrfMatch.split('=')[1] : ''

      const res = await fetch('/api/lists', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ listId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(`Failed to delete: ${data.error || res.statusText}`)
        return
      }
      router.push('/dashboard/lists')
      router.refresh()
    } catch (err) {
      alert('Network error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="p-2 text-label-tertiary active:text-[var(--tint-rewards)] rounded-lg active:bg-[var(--surface-fill)] disabled:opacity-50"
      aria-label={`Delete list ${listName}`}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}
