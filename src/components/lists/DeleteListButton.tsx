'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function DeleteListButton({ listId, listName }: { listId: string; listName: string }) {
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${listName}"? This will also delete all items in the list.`)) return

    setDeleting(true)
    try {
      const res = await fetch('/api/lists', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete list')

      router.push('/dashboard/lists')
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete list')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg"
      title="Delete list"
    >
      <Trash2 className="w-5 h-5" />
    </button>
  )
}