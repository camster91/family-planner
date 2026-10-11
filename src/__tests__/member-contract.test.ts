import fs from 'node:fs'
import path from 'node:path'
import { collectUserRelations, memberContractDifferences } from '../../scripts/member-contract.cjs'

const sample = `model Task {
  member User? @relation("TaskMember",
    fields: [member_id, family_id], references: [id, family_id])
  actor User @relation(fields: [actor_id], references: [id])
  inverse User[] @relation("Inverse")
}
// model Fake { invalid User @relation(fields: [fake], references: [id]) }
/* model Ignored {
 person User @relation(fields: [fake], references: [id])
} */`
const entry = (relation: string, fields: string[]) => ({ relation, fields, kind: 'member', migration: 'Retain history and separate login.' })
test('finds optional/multiline/composite owned relations while ignoring inverse relations and comments', () => {
  expect(collectUserRelations(sample)).toEqual([{ relation: 'Task.actor', fields: ['actor_id'] }, { relation: 'Task.member', fields: ['member_id', 'family_id'] }])
})
test('fails closed on an empty/unrecognized schema rather than claiming complete coverage', () => {
  expect(() => collectUserRelations('model Empty { }')).toThrow('No explicit User relations')
})
test('rejects unclassified relationships, changed FK fields and stale decisions', () => {
  const actual = collectUserRelations(sample)
  expect(memberContractDifferences(actual, [entry('Task.member', ['member_id']), entry('Removed.owner', ['user_id'])])).toEqual(expect.arrayContaining(['Task.actor: unclassified User relation', 'Task.member: foreign key fields changed', 'Removed.owner: stale inventory entry']))
})
test('rejects duplicate and invalid decisions', () => {
  const row = entry('Task.actor', ['actor_id'])
  expect(memberContractDifferences([], [row, row, { ...row, kind: 'anything', migration: '' }])).toEqual(expect.arrayContaining(['Task.actor: duplicate inventory entry', 'Task.actor: missing classification or migration decision']))
})
test('every current User foreign key has a deliberate migration decision', () => {
  const root = path.resolve(__dirname, '../..')
  const actual = collectUserRelations(fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8'))
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/architecture/member-relation-inventory.json'), 'utf8'))
  expect(actual).toHaveLength(64)
  expect(memberContractDifferences(actual, inventory)).toEqual([])
})
