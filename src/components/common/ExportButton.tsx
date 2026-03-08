'use client'

import { Download } from 'lucide-react'
import { exportToCSV } from '@/lib/utils'

interface ExportButtonProps {
  data: any[]
  filename: string
  label?: string
}

export default function ExportButton({ data, filename, label = 'Export CSV' }: ExportButtonProps) {
  return (
    <button
      onClick={() => exportToCSV(data, filename)}
      className="btn-secondary inline-flex items-center text-sm"
    >
      <Download className="w-4 h-4 mr-2" />
      {label}
    </button>
  )
}
