'use client'

import dynamic from 'next/dynamic'

const AdminControls = dynamic(() => import('@/components/admin/AdminControls'), {
  ssr: false,
  loading: () => null,
})

export default function AdminControlsWrapper() {
  // Only render in non-production builds. These are dev/test controls
  // (manual reminder sending, force-overdue, clear notifications) and
  // shouldn't appear in production UI. They're also responsible for several
  // WCAG contrast violations (text-gray-900 h3 at 1.18:1 on black in dark mode).
  if (process.env.NODE_ENV === 'production') return null
  return <AdminControls />
}
