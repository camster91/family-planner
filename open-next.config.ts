import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Migration build only (#604). Private household data must not enter shared caches.
// D1 and private R2 are wired only after their atomicity/ownership migrations pass.
export default defineCloudflareConfig({})
