import Link from 'next/link'
import { ArrowUpRight, LayoutGrid } from 'lucide-react'
import { MINI_APPS } from '@/lib/mini-apps'

const STATUS_LABELS = {
  active: 'Available',
  foundation: 'Foundation',
  planned: 'Planned',
} as const

export default function AppsPage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent-tint)] flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-large-title font-display">Apps</h1>
            <p className="text-subhead text-label-secondary mt-0.5">
              One Life Hub, with focused mini apps for the parts of life you actually use.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MINI_APPS.map((app) => {
          const Icon = app.icon
          const content = (
            <div className="card-apple h-full p-4 flex flex-col gap-3 transition-transform active:scale-[0.99]">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-fill)] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-label-secondary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-headline text-label-primary truncate">{app.title}</h2>
                    {app.href && <ArrowUpRight className="w-4 h-4 text-label-tertiary shrink-0" />}
                  </div>
                  <span className="inline-block mt-1 text-caption-2 font-medium text-label-tertiary bg-[var(--surface-fill)] px-2 py-0.5 rounded-full">
                    {STATUS_LABELS[app.status]}
                  </span>
                </div>
              </div>

              <p className="text-subhead text-label-secondary leading-relaxed flex-1">
                {app.description}
              </p>

              <p className="text-caption-1 text-label-tertiary">
                Source: {app.source}
              </p>
            </div>
          )

          if (!app.href) {
            return <div key={app.key} aria-disabled="true">{content}</div>
          }

          return (
            <Link key={app.key} href={app.href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              {content}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
