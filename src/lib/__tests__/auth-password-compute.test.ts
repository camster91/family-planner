jest.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      PASSWORD_COMPUTE: {
        fetch: async (request: Request) => {
          const body = (await request.json()) as {
            operation: string;
            secret: string;
          };
          return body.operation.startsWith("hash-")
            ? Response.json({ hash: "$2b$12$fixture" })
            : Response.json({ ok: body.secret === "correct" });
        },
      },
    },
  }),
}));

import { hashPassword, safeVerifyPassword, verifyPassword } from "../auth";

describe("native D1 password compute wiring", () => {
  const previousStorage = process.env.HEREWOVEN_STORAGE;

  beforeEach(() => {
    process.env.HEREWOVEN_STORAGE = "d1";
  });

  afterAll(() => {
    if (previousStorage === undefined) delete process.env.HEREWOVEN_STORAGE;
    else process.env.HEREWOVEN_STORAGE = previousStorage;
  });

  it("routes password and missing-account comparisons through the private binding", async () => {
    expect(await hashPassword("new-password", "member-a")).toBe(
      "$2b$12$fixture",
    );
    expect(await verifyPassword("correct", "$2b$12$fixture", "member-a")).toBe(
      true,
    );
    expect(await safeVerifyPassword("wrong", null, "unknown-member")).toBe(
      false,
    );
  });
});
