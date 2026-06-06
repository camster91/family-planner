'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Check, Trash2 } from 'lucide-react'

interface SwipeRowProps {
  children: React.ReactNode
  onSwipeLeft?: () => void   // complete action (right side, green)
  onSwipeRight?: () => void  // delete action (left side, red)
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  className?: string
}

const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const THRESHOLD_PX = 100

export function SwipeRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftContent,
  rightContent,
  className,
}: SwipeRowProps) {
  const [translateX, setTranslateX] = React.useState(0)
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const startXRef = React.useRef(0)
  const currentXRef = React.useRef(0)

  const rowWidth = React.useRef(0)

  React.useLayoutEffect(() => {
    if (containerRef.current) {
      rowWidth.current = containerRef.current.offsetWidth
    }
  }, [])

  const threshold = Math.max(THRESHOLD_PX, rowWidth.current * 0.4)

  const onPointerDown = (e: React.PointerEvent) => {
    setIsDragging(true)
    startXRef.current = e.clientX
    currentXRef.current = e.clientX
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const dx = e.clientX - startXRef.current
    currentXRef.current = e.clientX

    // Clamp so the underlying content never fully disappears
    const clamped = Math.max(-rowWidth.current * 0.5, Math.min(rowWidth.current * 0.5, dx))
    setTranslateX(clamped)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

    const dx = currentXRef.current - startXRef.current

    if (dx < -threshold && onSwipeLeft) {
      // Swiped left → complete action (revealed on right)
      onSwipeLeft()
    } else if (dx > threshold && onSwipeRight) {
      // Swiped right → delete action (revealed on left)
      onSwipeRight()
    }

    // Spring back
    setTranslateX(0)
  }

  const leftActionBg = 'bg-red-500'
  const rightActionBg = 'bg-green-500'
  const leftIcon = leftContent ?? <Trash2 className="w-5 h-5 text-white" />
  const rightIcon = rightContent ?? <Check className="w-5 h-5 text-white" />

  // Opacity of action revealed — proportional to how far we've swiped
  const leftReveal = Math.max(0, Math.min(1, translateX / threshold))
  const rightReveal = Math.max(0, Math.min(1, -translateX / threshold))

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden', className)}>
      {/* Left action (red, trash) — revealed when swiping right (translateX > 0) */}
      <div
        className={cn(
          'absolute inset-y-0 left-0 flex items-center px-4 pointer-events-none',
          leftActionBg
        )}
        style={{ opacity: leftReveal }}
      >
        {leftIcon}
      </div>

      {/* Right action (green, check) — revealed when swiping left (translateX < 0) */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none',
          rightActionBg
        )}
        style={{ opacity: rightReveal }}
      >
        {rightIcon}
      </div>

      {/* The swiping row itself */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging ? 'none' : `transform 400ms ${SPRING}`,
          willChange: 'transform',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  )
}