import { testCalendarConnections } from "./calendar-connections";
import type { D1Store } from "../../../src/lib/cloudflare/database";
export default {
  async fetch(_request: Request, env: { DB: D1Store }) {
    try {
      return Response.json(await testCalendarConnections(env.DB));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  },
};
