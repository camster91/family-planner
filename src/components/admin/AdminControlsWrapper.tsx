'use client'

import dynamic from 'next/dynamic'

const AdminControls = dynamic(() => import('@/components/admin/AdminControls'), {
  ssr: false,
  loading: () => null,
})

export default function AdminControlsWrapper() {
  return <AdminControls />
}
