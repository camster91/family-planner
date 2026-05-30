'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Tab {
  key: string
  label: string
}

interface ListsFilterTabsProps {
  tabs: Tab[]
  activeType: string
}

export default function ListsFilterTabs({ tabs, activeType }: ListsFilterTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleTabClick = (key: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (key === 'all') {
      params.delete('type')
    } else {
      params.set('type', key)
    }
    const query = params.toString()
    router.push(`/dashboard/lists${query ? `?${query}` : ''}`)
  }

  return (
    <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => handleTabClick(tab.key)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            activeType === tab.key
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
