import { defineConfig } from 'prisma/config'
// Generation/validation only. Apply the reviewed SQL migrations through Wrangler.
export default defineConfig({
  schema: 'cloudflare-read.prisma',
  datasource: { url: 'file:./unused-read-schema.db' },
})
