import {
  isLegacyAnalyticsType,
  legacyAnalyticsTypeFilter,
  pruneLegacyAnalytics,
  LEGACY_ANALYTICS_RETENTION_DAYS,
  LEGACY_ANALYTICS_RETENTION_MS,
} from '../legacy-analytics'

describe('legacy analytics', () => {
  it('matches legacy page-view/click types and never real household activity', () => {
    expect(isLegacyAnalyticsType('event_page_view')).toBe(true)
    expect(isLegacyAnalyticsType('event_cta_click')).toBe(true)
    expect(isLegacyAnalyticsType('event_created')).toBe(false)
    expect(isLegacyAnalyticsType('events_imported')).toBe(false)
    expect(isLegacyAnalyticsType('chore_completed')).toBe(false)
    expect(isLegacyAnalyticsType(undefined)).toBe(false)
    // `_` is a LIKE wildcard: escaped so `events_imported` never matches.
    expect(legacyAnalyticsTypeFilter()).toEqual({ startsWith: 'event\\_', notIn: ['event_created'] })
  })

  it('keeps 90 days', () => {
    expect(LEGACY_ANALYTICS_RETENTION_DAYS).toBe(90)
    expect(LEGACY_ANALYTICS_RETENTION_MS).toBe(90 * 86_400_000)
  })

  it('prunes one household, older than the cutoff, legacy types only', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 })
    const now = new Date('2026-09-30T12:00:00Z')
    await expect(pruneLegacyAnalytics({ activity: { deleteMany } } as never, 'family-1', now)).resolves.toBe(3)
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        family_id: 'family-1',
        created_at: { lt: new Date('2026-07-02T12:00:00Z') },
        type: { startsWith: 'event\\_', notIn: ['event_created'] },
      },
    })
  })

  it('does nothing without a household id', async () => {
    const deleteMany = jest.fn()
    await expect(pruneLegacyAnalytics({ activity: { deleteMany } } as never, '')).resolves.toBe(0)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('never throws and logs only the error class name', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const deleteMany = jest.fn().mockRejectedValue(new TypeError('value "family-1" secret'))
    await expect(pruneLegacyAnalytics({ activity: { deleteMany } } as never, 'family-1')).resolves.toBe(0)
    expect(warn).toHaveBeenCalledWith('Legacy analytics prune failed:', 'TypeError')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret')
    warn.mockRestore()
  })
})
