'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { BrandIllustration } from '@/components/ui/brand-illustration'
import type { BrandMotionSource } from '@/lib/brand-illustrations'

/**
 * A short Warm Paper loop (docs/product/BRAND.md), always decorative.
 *
 * The server render and the first client render show the transparent still
 * illustration, so hydration always matches. After mount the still is
 * swapped for a muted, looping, inline <video> only when all of these hold:
 *   - the viewer has not asked for reduced motion (OS setting or the app's
 *     `.reduce-motion` class),
 *   - data saver is off (`navigator.connection.saveData`),
 *   - the app is in light mode: the loops sit on a flat cream ground, which
 *     would show as a cream box on navy, so dark mode keeps the still.
 * `preload="none"`: nothing downloads until it plays. With `play="in-view"`
 * (the default) it plays only while on screen and pauses when scrolled away;
 * `play="immediate"` (the landing hero) starts at once.
 */

type Env = 'still' | 'motion'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function readEnv(): Env {
  try {
    const root = document.documentElement
    if (root.classList.contains('dark') || root.classList.contains('reduce-motion')) return 'still'
    if (typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_QUERY).matches) return 'still'
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (connection?.saveData) return 'still'
    return 'motion'
  } catch {
    return 'still'
  }
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  const mql = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE_QUERY) : null
  mql?.addEventListener?.('change', onChange)
  return () => {
    observer.disconnect()
    mql?.removeEventListener?.('change', onChange)
  }
}

/** 'still' on the server and while hydrating; the viewer's setting after. */
export function useBrandMotionEnv(): Env {
  return React.useSyncExternalStore(subscribe, readEnv, () => 'still')
}

export function BrandMotion({
  motion,
  className,
  play = 'in-view',
  priority = false,
  sizes,
}: {
  motion: BrandMotionSource
  /** Sizing classes, applied to the video and the still alike. */
  className?: string
  play?: 'in-view' | 'immediate'
  /** Load the still eagerly (above the fold). */
  priority?: boolean
  /** `sizes` for the still's srcset. */
  sizes?: string
}) {
  const env = useBrandMotionEnv()
  const ref = React.useRef<HTMLVideoElement>(null)

  React.useEffect(() => {
    const video = ref.current
    if (!video || env !== 'motion') return
    video.muted = true
    const start = () => {
      const p = video.play()
      if (p && typeof p.catch === 'function') p.catch(() => undefined)
    }
    if (play === 'immediate' || typeof IntersectionObserver === 'undefined') {
      start()
      return () => video.pause()
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) start()
          else video.pause()
        }
      },
      { threshold: 0.1 }
    )
    io.observe(video)
    return () => {
      io.disconnect()
      video.pause()
    }
  }, [env, play])

  if (env !== 'motion') {
    return (
      <BrandIllustration
        source={motion.still}
        srcSet={motion.stillSrcSet}
        sizes={sizes}
        priority={priority}
        className={className}
      />
    )
  }

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      autoPlay={play === 'immediate'}
      preload="none"
      poster={motion.poster}
      width={motion.width}
      height={motion.height}
      aria-hidden="true"
      tabIndex={-1}
      disablePictureInPicture
      data-brand-motion=""
      className={cn('pointer-events-none select-none bg-[var(--brand-cream)] object-cover', className)}
    >
      {motion.sources.map((s) => (
        <source key={s.src} src={s.src} type={s.type} media={s.media} />
      ))}
    </video>
  )
}
