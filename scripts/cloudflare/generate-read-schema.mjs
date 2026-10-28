#!/usr/bin/env node
/** Generate a SQLite read-client schema. D1 migrations remain explicit SQL. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
schema = schema.replace(/generator client \{[\s\S]*?\n\}/, `generator client {
  provider = "prisma-client"
  output = "../src/generated/cloudflare-read"
  runtime = "cloudflare"
}`)
schema = schema.replace('provider = "postgresql"', 'provider = "sqlite"')
schema = schema.split('\n').map(line => {
  const scalarArray = /^\s*\w+\s+(String|Int)\[\]/.test(line)
  if (scalarArray) line = line.replace(/\b(String|Int)\[\]/, 'Json').replace('@default([])', '@default("[]")')
  if (line.includes('@relation(')) line = line.replace(/,\s*map:\s*"[^"]*"/g, '')
  return line.replace(/@db\.\w+(?:\([^)]*\))?/g, '')
}).join('\n')
schema = schema.replace(/dbgenerated\(("(?:\\.|[^"\\])*")\)/g, (_, literal) => {
  if (!JSON.parse(literal).includes('gen_random_uuid()')) throw new Error('Review unknown database default before generating D1 reads')
  return 'dbgenerated("(lower(hex(randomblob(16))))")'
})
fs.writeFileSync(path.join(root, 'prisma/cloudflare-read.prisma'), '// Generated read-only projection of schema.prisma; do not use for D1 migrations.\n'+schema)
console.log('Generated SQLite read schema; native D1 migrations are unchanged.')
