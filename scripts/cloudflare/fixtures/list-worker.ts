import { testListDelete } from "./list-delete";
import { testLists } from "./lists";
import type { D1Store } from "../../../src/lib/cloudflare/database";
export default {
  async fetch(_request: Request, env: { DB: D1Store }) {
    if (new URL(_request.url).pathname !== "/lists")
      return Response.json({ ready: true });
    try {
      return Response.json({
        ...(await testLists(env.DB)),
        ...(await testListDelete(env.DB)),
      });
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: error instanceof Error ? error.message : "unknown" },
        { status: 500 },
      );
    }
  },
};
