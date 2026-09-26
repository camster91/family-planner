// Real-Postgres checks for the shared device (#240) where the fake DB cannot
// prove the behaviour: unique/atomic claims, `SELECT … FOR UPDATE` capacity
// serialisation, FK cascades and "no plaintext token at rest".
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

import bcrypt from 'bcryptjs'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('shared device against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/device-session')
  let pairing: typeof import('@/lib/device-pairing')

  const FAM = 'devint-family'
  const FAM2 = 'devint-family-2'
  const PARENT = 'devint-parent'
  const PARENT2 = 'devint-parent-2'
  const now = () => new Date()

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, PARENT2] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/device-session')
    pairing = await import('@/lib/device-pairing')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Device Int', invite_code: 'devint-invite' },
        { id: FAM2, name: 'Device Int 2', invite_code: 'devint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@devint.test', name: 'P', role: 'parent', family_id: FAM },
        { id: PARENT2, email: 'p2@devint.test', name: 'P2', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.householdDevice.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.devicePairing.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.deviceAuditEvent.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
  })

  async function seedActiveDevices(familyId: string, n: number): Promise<string[]> {
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const d = await prisma.householdDevice.create({
        data: { family_id: familyId, label: `Tablet ${i}`, platform: 'web' },
        select: { id: true },
      })
      await lib.createDeviceSession(prisma, d.id, familyId, now())
      ids.push(d.id)
    }
    return ids
  }

  async function confirmedPairing(familyId = FAM, createdBy = PARENT, replacesDeviceId: string | null = null) {
    const created = await pairing.createPairing(prisma, {
      familyId,
      userId: createdBy,
      label: 'New tablet',
      now: now(),
      replacesDeviceId,
    })
    if (!created.ok) throw new Error('create failed')
    const claimed = await pairing.claimPairing(prisma, { code: created.code, platform: 'web', appVersion: null, now: now() })
    if (!claimed.ok) throw new Error('claim failed')
    const confirmed = await pairing.confirmPairing(prisma, {
      pairingId: created.pairingId,
      familyId,
      userId: createdBy,
      digits: claimed.confirmDigits,
      now: now(),
    })
    expect(confirmed).toEqual({ kind: 'confirmed', newly: true })
    return { ...created, claimToken: claimed.claimToken }
  }

  // §14.4 item 25
  it('a code is single use under concurrency (parallel claims → one success)', async () => {
    const created = await pairing.createPairing(prisma, { familyId: FAM, userId: PARENT, label: 'Tab', now: now() })
    if (!created.ok) throw new Error('create failed')
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        pairing.claimPairing(prisma, { code: created.code, platform: 'android', appVersion: '1.0', now: now() })
      )
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  // §14.4 item 27 (issue-time re-check under FOR UPDATE)
  it('two concurrent issues with one slot left create exactly one device', async () => {
    const a = await confirmedPairing()
    const b = await confirmedPairing()
    await seedActiveDevices(FAM, 4)
    const rows = await Promise.all(
      [a.claimToken, b.claimToken].map((t) => pairing.findPairingByClaimToken(prisma, t))
    )
    const results = await Promise.all(rows.map((row) => pairing.issuePairedDevice(prisma, row!, now())))
    expect(results.map((r) => r.kind).sort()).toEqual(['limit', 'paired'])
    expect(await prisma.householdDevice.count({ where: { family_id: FAM, revoked_at: null } })).toBe(5)
  })

  // §7 "Replace" (#241 review): at the limit, atomic revoke + issue.
  it('a replacing pairing works at the limit: the old tablet is revoked in the issuing transaction', async () => {
    const ids = await seedActiveDevices(FAM, 5)
    const plain = await pairing.createPairing(prisma, { familyId: FAM, userId: PARENT, label: 'x', now: now() })
    expect(plain).toEqual({ ok: false, code: 'DEVICE_LIMIT_REACHED' })
    const a = await confirmedPairing(FAM, PARENT, ids[0])
    const row = await pairing.findPairingByClaimToken(prisma, a.claimToken)
    const issued = await pairing.issuePairedDevice(prisma, row!, now())
    expect(issued).toMatchObject({ kind: 'paired', replacedDeviceId: ids[0] })
    const old = await prisma.householdDevice.findUnique({ where: { id: ids[0] } })
    expect(old).toMatchObject({ revoke_reason: 'replaced', revoked_by: PARENT })
    expect(await prisma.deviceSession.count({ where: { device_id: ids[0], revoked_at: null } })).toBe(0)
    expect(await prisma.householdDevice.count({ where: { family_id: FAM, revoked_at: null } })).toBe(5)
  })

  it('a replacing issue that would still exceed the limit rolls back the revoke', async () => {
    const ids = await seedActiveDevices(FAM, 5)
    const a = await confirmedPairing(FAM, PARENT, ids[0])
    // Something else fills the freed slot before issue (bypassing capacity on purpose).
    await seedActiveDevices(FAM, 1)
    const row = await pairing.findPairingByClaimToken(prisma, a.claimToken)
    expect(await pairing.issuePairedDevice(prisma, row!, now())).toEqual({ kind: 'limit' })
    // The old tablet was not left revoked without a replacement.
    expect((await prisma.householdDevice.findUnique({ where: { id: ids[0] } }))!.revoked_at).toBeNull()
    expect((await prisma.devicePairing.findUnique({ where: { id: a.pairingId } }))!.cancelled_at).not.toBeNull()
  })

  it('deleting a replaced tablet row leaves the pairing (FK SET NULL)', async () => {
    const ids = await seedActiveDevices(FAM, 1)
    const created = await pairing.createPairing(prisma, {
      familyId: FAM,
      userId: PARENT,
      label: 'x',
      now: now(),
      replacesDeviceId: ids[0],
    })
    if (!created.ok) throw new Error('create failed')
    await prisma.householdDevice.delete({ where: { id: ids[0] } })
    expect((await prisma.devicePairing.findUnique({ where: { id: created.pairingId } }))!.replaces_device_id).toBeNull()
  })

  it('the same pairing issued twice concurrently mints one device', async () => {
    const a = await confirmedPairing()
    const row = await pairing.findPairingByClaimToken(prisma, a.claimToken)
    const results = await Promise.all([1, 2, 3].map(() => pairing.issuePairedDevice(prisma, row!, now())))
    expect(results.filter((r) => r.kind === 'paired')).toHaveLength(1)
    expect(await prisma.householdDevice.count({ where: { family_id: FAM } })).toBe(1)
  })

  it('concurrent pairing creation never over-reserves capacity', async () => {
    await seedActiveDevices(FAM, 3)
    const results = await Promise.all(
      Array.from({ length: 4 }, () => pairing.createPairing(prisma, { familyId: FAM, userId: PARENT, label: 'x', now: now() }))
    )
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    const pending = await prisma.devicePairing.count({ where: { family_id: FAM, cancelled_at: null, device_id: null } })
    expect(pending).toBe(2)
  })

  // §14.3 items 16, 18, 19 and 22 on real rows
  it('stores no plaintext token, rotates, detects reuse, and cascades on family deletion', async () => {
    const a = await confirmedPairing()
    const row = await pairing.findPairingByClaimToken(prisma, a.claimToken)
    const issued = await pairing.issuePairedDevice(prisma, row!, now())
    if (issued.kind !== 'paired') throw new Error('issue failed')
    const deviceId = issued.device.id

    // Two refreshes racing with the same token: one rotates, the other lands in
    // the grace path; the device stays active.
    const racing = await Promise.all([
      lib.refreshDeviceSession(prisma, issued.tokens.refreshToken, now()),
      lib.refreshDeviceSession(prisma, issued.tokens.refreshToken, now()),
    ])
    expect(racing.every((r) => r.ok)).toBe(true)
    const latest = racing[1].ok ? racing[1].tokens : null
    expect((await prisma.householdDevice.findUnique({ where: { id: deviceId } }))!.revoked_at).toBeNull()

    // Elevation and a PIN, then scan every device table for plaintext.
    await prisma.parentElevationPin.create({
      data: { user_id: PARENT, family_id: FAM, pin_hash: bcrypt.hashSync('482913', 4) },
    })
    const elevation = await lib.startElevation(prisma, { deviceId, parentId: PARENT, tokenVersion: 0, method: 'pin', now: now() })
    expect(elevation?.token).toMatch(/^fpd1_e_/)
    for (const table of ['HouseholdDevice', 'DeviceSession', 'DevicePairing', 'DeviceAuditEvent', 'ParentElevationPin']) {
      const hits = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${table}" x WHERE row_to_json(x)::text LIKE '%fpd1\\_%' OR row_to_json(x)::text LIKE '%482913%'`
      )
      expect([table, Number(hits[0].n)]).toEqual([table, 0])
    }

    // Use whichever successor is live, then replay the original → reuse → revoked.
    const live = await Promise.all(
      racing.map((r) => (r.ok ? lib.resolveDeviceAccess(prisma, { access: r.tokens.accessToken }, now()) : null))
    )
    expect(live.some((r) => r?.ok)).toBe(true)
    const replay = await lib.refreshDeviceSession(prisma, issued.tokens.refreshToken, now())
    expect(replay).toMatchObject({ ok: false, code: 'DEVICE_REVOKED' })
    expect(await prisma.deviceAuditEvent.count({ where: { device_id: deviceId, type: 'device.token_reuse_detected' } })).toBe(1)
    if (latest) {
      expect(await lib.refreshDeviceSession(prisma, latest.refreshToken, now())).toMatchObject({ code: 'DEVICE_REVOKED' })
    }

    // Family deletion cascades the device, its sessions, pairings, audit and PINs.
    const other = await confirmedPairing(FAM2, PARENT2)
    const otherRow = await pairing.findPairingByClaimToken(prisma, other.claimToken)
    const otherIssued = await pairing.issuePairedDevice(prisma, otherRow!, now())
    if (otherIssued.kind !== 'paired') throw new Error('issue failed')
    await prisma.family.delete({ where: { id: FAM2 } })
    expect(await lib.resolveDeviceAccess(prisma, { access: otherIssued.tokens.accessToken }, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })
    expect(await prisma.deviceSession.count({ where: { family_id: FAM2 } })).toBe(0)
    await prisma.family.create({ data: { id: FAM2, name: 'Device Int 2', invite_code: 'devint-invite-2' } })
    await prisma.user.update({ where: { id: PARENT2 }, data: { family_id: FAM2 } })
    await prisma.parentElevationPin.deleteMany({ where: { user_id: PARENT } })
  })
})
