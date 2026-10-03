import { escapeHtml } from '@/lib/escape-html'
import { EMAIL_BANNER } from '@/lib/brand-illustrations'

/**
 * Warm Paper frame for transactional email HTML (docs/product/BRAND.md).
 * Only the HTML part is branded; plain-text parts stay as they are.
 *
 * Mail clients ignore <style> blocks and most CSS, so everything is inline:
 * cream page, warm white card, navy ink. The houses banner is an absolute
 * URL to this app's public file (PNG, because some clients do not show WebP)
 * with an empty alt: it is decoration, and a client that blocks images loses
 * nothing.
 */

export const EMAIL_COLORS = {
  page: '#FBF7F0',
  card: '#FFFDF9',
  ink: '#1F2A44', // 14.03:1 on card
  muted: '#4A5068', // 7.83:1 on card
  link: '#A3452A', // terracotta, 6.01:1 on card
  rule: '#E6DDCC',
  button: '#1F2A44',
  buttonText: '#FFFDF9', // 14.03:1 on button
} as const

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca').replace(/\/+$/, '')
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const SERIF = "Georgia, 'Times New Roman', serif"

/** A primary call-to-action link styled as a navy button. */
export function emailButton(href: string, label: string): string {
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:${EMAIL_COLORS.button};` +
    `color:${EMAIL_COLORS.buttonText};padding:12px 24px;border-radius:10px;text-decoration:none;` +
    `font-weight:600;font-family:${SANS};">${escapeHtml(label)}</a>`
  )
}

/** Wraps already-escaped body HTML in the branded frame. */
export function brandedEmailHtml(bodyHtml: string, appUrl: string = appBaseUrl()): string {
  const banner = `${appUrl.replace(/\/+$/, '')}${EMAIL_BANNER.path}`
  const body = bodyHtml.replace(
    /<h2>/g,
    `<h2 style="margin:0 0 16px;font-family:${SERIF};font-size:24px;line-height:1.25;font-weight:600;color:${EMAIL_COLORS.ink};">`
  )
  return [
    `<div style="background:${EMAIL_COLORS.page};padding:24px 12px;">`,
    `<div style="max-width:${EMAIL_BANNER.width}px;margin:0 auto;background:${EMAIL_COLORS.card};border-radius:14px;overflow:hidden;border:1px solid ${EMAIL_COLORS.rule};">`,
    `<img src="${escapeHtml(banner)}" width="${EMAIL_BANNER.width}" alt="" style="display:block;width:100%;max-width:${EMAIL_BANNER.width}px;height:auto;border:0;background:${EMAIL_COLORS.page};">`,
    `<div style="padding:24px 28px;font-family:${SANS};font-size:16px;line-height:1.5;color:${EMAIL_COLORS.ink};">`,
    body,
    `</div>`,
    `</div>`,
    `</div>`,
  ].join('\n')
}
