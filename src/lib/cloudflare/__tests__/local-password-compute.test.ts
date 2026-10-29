import {
  createPasswordComputeServiceAdapter,
  createLocalPasswordComputeAdapter,
  PasswordComputeUnavailableError,
  PASSWORD_COMPUTE_SERVICE_PATH,
} from "../local-password-compute";

describe("password compute clients", () => {
  it("uses the private service binding protocol for passwords and PINs", async () => {
    const calls: Array<{
      operation: string;
      secret: string;
      encodedHash?: string;
    }> = [];
    const service = createPasswordComputeServiceAdapter({
      fetch: async (request) => {
        expect(new URL(request.url).pathname).toBe(
          PASSWORD_COMPUTE_SERVICE_PATH,
        );
        expect(request.method).toBe("POST");
        const body = (await request.json()) as {
          operation: string;
          secret: string;
          encodedHash?: string;
        };
        calls.push(body);
        if (body.operation.startsWith("hash-"))
          return Response.json({ hash: "$2b$12$fixture" });
        return Response.json({
          ok:
            body.secret === "correct" && body.encodedHash === "$2b$12$fixture",
        });
      },
    });

    expect(await service.hashPassword("correct", "member-a")).toBe(
      "$2b$12$fixture",
    );
    expect(
      await service.verifyPassword("correct", "$2b$12$fixture", "member-a"),
    ).toBe(true);
    expect(await service.hashPin("482957", "member-a")).toBe("$2b$12$fixture");
    expect(await service.verifyPin("wrong", "$2b$12$fixture", "member-a")).toBe(
      false,
    );
    expect(calls.map((call) => call.operation)).toEqual([
      "hash-password",
      "compare-password",
      "hash-pin",
      "compare-pin",
    ]);
  });

  it("fails closed when either private binding is missing", () => {
    expect(() => createPasswordComputeServiceAdapter(undefined)).toThrow(
      PasswordComputeUnavailableError,
    );
    expect(() => createLocalPasswordComputeAdapter(undefined)).toThrow(
      PasswordComputeUnavailableError,
    );
  });
});
