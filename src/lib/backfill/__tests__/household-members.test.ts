import { memberIdForLegacyUser, parseMemberRehearsalArgs } from '../household-members'

it('requires one explicit fixture family and rejects production/unknown/duplicate options', () => {
  expect(parseMemberRehearsalArgs(['--family', 'fx_family_a'])).toEqual({ familyId: 'fx_family_a', apply: false })
  expect(parseMemberRehearsalArgs(['--apply', '--family', 'fx_family_a'])).toEqual({ familyId: 'fx_family_a', apply: true })
  for (const args of [[], ['--family', 'real-household'], ['--family', 'fx_a', '--family', 'fx_b'], ['--family', 'fx_a', '--apply', '--apply'], ['--family', 'fx_a', '--i-have-approval']]) {
    expect(() => parseMemberRehearsalArgs(args)).toThrow()
  }
})

it('keeps deterministic member identity distinct from account identity and household boundaries', () => {
  const id = memberIdForLegacyUser('fx_a', 'fx_user')
  expect(memberIdForLegacyUser('fx_a', 'fx_user')).toBe(id)
  expect(id).not.toBe('fx_user')
  expect(memberIdForLegacyUser('fx_b', 'fx_user')).not.toBe(id)
  expect(memberIdForLegacyUser('a:b', 'c')).not.toBe(memberIdForLegacyUser('a', 'b:c'))
})
