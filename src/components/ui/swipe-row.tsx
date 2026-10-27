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
  /** The semantic action revealed by a left swipe. Defaults to completion. */
  swipeLeftTone?: SwipeActionTone
  /** The semantic action revealed by a right swipe. Defaults to deletion. */
  swipeRightTone?: SwipeActionTone
  className?: string
}

export type SwipeActionTone = 'complete' | 'delete'

const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const THRESHOLD_PX = 100

export function SwipeRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftContent,
  rightContent,
  swipeLeftTone = 'complete',
  swipeRightTone = 'delete',
  className,
}: SwipeRowProps) {
  const [translateX, setTranslateX] = React.useState(0)
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const startXRef = React.useRef(0)
  const currentXRef = React.useRef(0)
  const captureTargetRef = React.useRef<HTMLElement | null>(null)

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
    const target = e.target
    if (target instanceof HTMLElement && target.setPointerCapture) {
      try {
        target.setPointerCapture(e.pointerId)
        captureTargetRef.current = target
      } catch {
        // Pointer capture is optional on older WebViews. The gesture still
        // works while the pointer remains over the row.
        captureTargetRef.current = null
      }
    }
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
    const target = captureTargetRef.current
    if (target?.hasPointerCapture?.(e.pointerId))
      target.releasePointerCapture(e.pointerId)
    captureTargetRef.current = null

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

  const onPointerCancel = (e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    const target = captureTargetRef.current
    if (target?.hasPointerCapture?.(e.pointerId))
      target.releasePointerCapture(e.pointerId)
    captureTargetRef.current = null
    currentXRef.current = startXRef.current
    // A cancelled pointer must never trigger either semantic action.
    setTranslateX(0)
  }

  const leftActionBg =
    swipeRightTone === 'delete' ? 'bg-danger-fill' : 'bg-success'
  const rightActionBg =
    swipeLeftTone === 'delete' ? 'bg-danger-fill' : 'bg-success'
  const leftIcon =
    leftContent ??
    (swipeRightTone === 'delete' ? (
      <Trash2 className="w-5 h-5 text-white" aria-hidden="true" />
    ) : (
      <Check className="w-5 h-5 text-white" aria-hidden="true" />
    ))
  const rightIcon =
    rightContent ??
    (swipeLeftTone === 'delete' ? (
      <Trash2 className="w-5 h-5 text-white" aria-hidden="true" />
    ) : (
      <Check className="w-5 h-5 text-white" aria-hidden="true" />
    ))

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
        onPointerCancel={onPointerCancel}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging ? 'none' : `transform 400ms ${SPRING}`,
          willChange: 'transform',
          touchAction: 'pan-y',
        }}
        className="motion-reduce:!transition-none"
      >
        {children}
      </div>
    </div>
  )
}
