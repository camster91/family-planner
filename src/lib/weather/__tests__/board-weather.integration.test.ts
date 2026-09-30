// Real-Postgres checks for the board weather cache (#262) where the fake DB
// cannot prove the behaviour: the WeatherCache upsert (including the JSON NULL
// payload of a failed fetch) through the pg driver adapter, per-household rows,
// the family-delete cascade, and the board-settings columns' defaults.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.
// No network: every fetch is a stub.

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

const FORECAST = {
  utc_offset_seconds: -14400,
  timezone: 'America/Toronto',
  current: { temperature_2m: 21.4, weather_code: 2, is_day: 1 },
  daily: {
    time: ['2026-06-01', '2026-06-02'],
    weather_code: [2, 61],
    temperature_2m_max: [24, 19],
    temperature_2m_min: [12, 11],
    precipitation_probability_max: [5, 70],
  },
}

describeWithDatabase('board weather against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/weather/board-weather')

  const FAM = 'wxint-family'
  const FAM2 = 'wxint-family-2'
  const USER = 'wxint-user'
  const NOW = new Date('2026-06-01T12:00:00Z')

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: USER } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/weather/board-weather')
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Wx Int', invite_code: 'wxint-invite' },
        { id: FAM2, name: 'Wx Int 2', invite_code: 'wxint-invite-2' },
      ],
    })
    await prisma.user.create({ data: { id: USER, email: 'u@wxint.test', name: 'U', role: 'parent', family_id: FAM } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(() => {
    process.env.WEATHER_ENABLED = '1'
    lib.__resetWeatherInflight()
  })

  it('defaults: weather off, Celsius, no place, no member colour', async () => {
    const family = await prisma.family.findUniqueOrThrow({
      where: { id: FAM },
      select: { weather_enabled: true, weather_unit: true, weather_latitude: true, weather_label: true },
    })
    expect(family).toEqual({ weather_enabled: false, weather_unit: 'celsius', weather_latitude: null, weather_label: null })
    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER }, select: { board_color: true } })
    expect(user.board_color).toBeNull()
    const fetchImpl = jest.fn()
    expect(await lib.getBoardWeather(prisma, { familyId: FAM, now: NOW, fetchImpl })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stores ok and error rows per household, serves the cache, and backs off after a failure', async () => {
    await prisma.family.update({
      where: { id: FAM },
      data: { weather_enabled: true, weather_latitude: 43.65, weather_longitude: -79.38, weather_label: 'Toronto' },
    })
    await prisma.family.update({
      where: { id: FAM2 },
      data: { weather_enabled: true, weather_latitude: 51.51, weather_longitude: -0.13, weather_label: 'London' },
    })

    const ok = jest.fn(async () => new Response(JSON.stringify(FORECAST), { status: 200 }))
    const first = await lib.getBoardWeather(prisma, { familyId: FAM, now: NOW, fetchImpl: ok })
    expect(first).toMatchObject({ label: 'Toronto', current: { temperature: 21, summary: 'Partly cloudy' } })
    const row = await prisma.weatherCache.findUniqueOrThrow({ where: { family_id: FAM } })
    expect(row).toMatchObject({ status: 'ok', latitude: 43.65, longitude: -79.38 })
    expect((row.payload as any).current.temperatureC).toBe(21.4)
    // The place's offset is cached so "today" is chosen by the place's date.
    expect((row.payload as any).utcOffsetSeconds).toBe(-14400)
    expect(first?.utcOffsetSeconds).toBe(-14400)

    // Served from the row; no request.
    const cached = await lib.getBoardWeather(prisma, { familyId: FAM, now: new Date(NOW.getTime() + 60_000), fetchImpl: ok })
    expect(cached?.fetchedAt).toBe(NOW.toISOString())
    expect(ok).toHaveBeenCalledTimes(1)

    // Household 2 fails: an 'error' row with a JSON NULL payload, and household 1 is untouched.
    const down = jest.fn(async () => new Response('down', { status: 503 }))
    expect(await lib.getBoardWeather(prisma, { familyId: FAM2, now: NOW, fetchImpl: down })).toBeNull()
    const failed = await prisma.weatherCache.findUniqueOrThrow({ where: { family_id: FAM2 } })
    expect(failed.status).toBe('error')
    expect(failed.payload).toBeNull()
    expect(await lib.getBoardWeather(prisma, { familyId: FAM2, now: new Date(NOW.getTime() + 60_000), fetchImpl: down })).toBeNull()
    expect(down).toHaveBeenCalledTimes(1)
    expect((await prisma.weatherCache.findUniqueOrThrow({ where: { family_id: FAM } })).status).toBe('ok')

    // Recovery replaces the error row in place (upsert on the family key).
    const later = new Date(NOW.getTime() + lib.WEATHER_ERROR_BACKOFF_MS + 1000)
    expect(await lib.getBoardWeather(prisma, { familyId: FAM2, now: later, fetchImpl: ok })).toMatchObject({ label: 'London' })
    expect(await prisma.weatherCache.count({ where: { family_id: FAM2 } })).toBe(1)
  })

  it('deleting a household deletes its cache row', async () => {
    const temp = 'wxint-family-temp'
    await prisma.family.create({ data: { id: temp, name: 'Temp', invite_code: 'wxint-invite-temp' } })
    await prisma.weatherCache.create({
      data: { family_id: temp, latitude: 1, longitude: 1, status: 'ok', payload: {}, fetched_at: NOW },
    })
    await prisma.family.delete({ where: { id: temp } })
    expect(await prisma.weatherCache.count({ where: { family_id: temp } })).toBe(0)
  })
})
