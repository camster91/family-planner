import type { Metadata } from 'next'
import { PostHogProvider } from '@/components/providers/posthog-provider'
import { ToastProvider } from '@/components/ui/toast'
import './globals.css'

export const metadata: Metadata = {
  title: 'Family Planner - Organize Your Family Life',
  description: 'Family management app for chores, calendar, communication, and tracking',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <PostHogProvider>
          <ToastProvider>
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
              {children}
            </div>
          </ToastProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
