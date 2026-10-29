/**
 * Minimal module-only declaration for the Cloudflare Workers built-in entry
 * point. Keep this scoped to the module: importing the full workers-types
 * ambient package would replace the application's DOM Response.json type
 * with `unknown` across the Next.js project.
 */
declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown> {
    constructor(ctx: unknown, env: Env);
  }
}
