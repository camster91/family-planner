/**
 * Warm Paper illustration set (docs/product/BRAND.md). Files live in
 * public/brand/illustrations/ and are already compressed; width and height are
 * the file's intrinsic pixels, passed to <img> so the browser reserves the
 * right box before the image loads (no layout shift).
 *
 * Every illustration is decorative: the text next to it says the same thing.
 * Add a new one here, never as a raw path in a component.
 */
export interface BrandIllustrationSource {
  src: string
  width: number
  height: number
}

const dir = '/brand/illustrations'

export const ILLUSTRATIONS = {
  choresClear: { src: `${dir}/chores-clear.webp`, width: 480, height: 362 },
  calendarEmpty: { src: `${dir}/calendar-empty.webp`, width: 480, height: 402 },
  mealsEmpty: { src: `${dir}/meals-empty.webp`, width: 480, height: 361 },
  groceriesClear: { src: `${dir}/groceries-clear.webp`, width: 450, height: 480 },
  listsEmpty: { src: `${dir}/lists-empty.webp`, width: 393, height: 480 },
  rewards: { src: `${dir}/rewards.webp`, width: 480, height: 431 },
  celebrate: { src: `${dir}/celebrate.webp`, width: 480, height: 468 },
  notificationsQuiet: { src: `${dir}/notifications-quiet.webp`, width: 480, height: 445 },
  invite: { src: `${dir}/invite.webp`, width: 381, height: 480 },
  messagesEmpty: { src: `${dir}/messages-empty.webp`, width: 480, height: 409 },
  help: { src: `${dir}/help.webp`, width: 424, height: 480 },
  getStarted: { src: `${dir}/get-started.webp`, width: 480, height: 204 },
  housesBanner: { src: `${dir}/houses-banner.webp`, width: 960, height: 247 },
  authEntryway: { src: `${dir}/auth-entryway.webp`, width: 720, height: 900 },
  heroKitchen: { src: `${dir}/hero-kitchen-1600.webp`, width: 1600, height: 905 },
  heroKitchenSmall: { src: `${dir}/hero-kitchen-800.webp`, width: 800, height: 452 },
} as const satisfies Record<string, BrandIllustrationSource>

export type BrandIllustrationName = keyof typeof ILLUSTRATIONS

/**
 * Short seamless loops (public/brand/motion/). Each is VP9 WebM plus H.264
 * MP4 and a poster frame, on a flat cream #FBF7F0 ground (not transparent).
 * `still` is the transparent illustration shown instead in dark mode, with
 * reduced motion or data saver, and in the server render.
 */
export interface BrandMotionSource {
  /** Sources in preference order; a `media` query picks a size where supported. */
  sources: ReadonlyArray<{ src: string; type: 'video/webm' | 'video/mp4'; media?: string }>
  poster: string
  width: number
  height: number
  still: BrandIllustrationSource
  /** Optional srcset for the still (the hero). */
  stillSrcSet?: string
}

const motionDir = '/brand/motion'
const loop = (name: string) =>
  [
    { src: `${motionDir}/${name}.webm`, type: 'video/webm' as const },
    { src: `${motionDir}/${name}.mp4`, type: 'video/mp4' as const },
  ] as const

export const MOTION = {
  celebrate: {
    sources: loop('celebrate'),
    poster: `${motionDir}/celebrate-poster.webp`,
    width: 360,
    height: 360,
    still: ILLUSTRATIONS.celebrate,
  },
  tea: {
    sources: loop('tea'),
    poster: `${motionDir}/tea-poster.webp`,
    width: 360,
    height: 360,
    still: ILLUSTRATIONS.choresClear,
  },
  moon: {
    sources: loop('moon'),
    poster: `${motionDir}/moon-poster.webp`,
    width: 360,
    height: 360,
    still: ILLUSTRATIONS.notificationsQuiet,
  },
  getStarted: {
    sources: loop('getstarted'),
    poster: `${motionDir}/getstarted-poster.webp`,
    width: 640,
    height: 358,
    still: ILLUSTRATIONS.getStarted,
  },
  hero: {
    sources: [
      { src: `${motionDir}/hero-1280.webm`, type: 'video/webm', media: '(min-width: 800px)' },
      { src: `${motionDir}/hero-1280.mp4`, type: 'video/mp4', media: '(min-width: 800px)' },
      { src: `${motionDir}/hero-720.webm`, type: 'video/webm' },
      { src: `${motionDir}/hero-720.mp4`, type: 'video/mp4' },
    ],
    poster: `${motionDir}/hero-poster.webp`,
    width: 1280,
    height: 724,
    still: ILLUSTRATIONS.heroKitchen,
    stillSrcSet: `${ILLUSTRATIONS.heroKitchenSmall.src} 800w, ${ILLUSTRATIONS.heroKitchen.src} 1600w`,
  },
} as const satisfies Record<string, BrandMotionSource>

/** Email header banner (PNG for mail clients that do not show WebP). */
export const EMAIL_BANNER = { path: `${dir}/houses-banner-email.png`, width: 600, height: 154 } as const
