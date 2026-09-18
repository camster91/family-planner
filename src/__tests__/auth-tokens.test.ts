// Regression tests for #183 (P0): reset/verify tokens must never be stored in
// plaintext, and consuming one must be a single-use, atomic claim.

const update = jest.fn()
const updateMany = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get update() {
        return update;
      },
      get updateMany() {
        return updateMany;
      },
    },
  },
}));

import { hashToken, createResetToken, consumeResetToken } from "@/lib/tokens";

describe("token storage", () => {
  beforeEach(() => {
    update.mockReset();
    updateMany.mockReset();
  });

  describe("hashToken", () => {
    it("is sha256 hex, and not the token itself", () => {
      const hash = hashToken("abc");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // Known sha256("abc")
      expect(hash).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });

    it("is deterministic", () => {
      expect(hashToken("t")).toBe(hashToken("t"));
    });
  });

  describe("createResetToken", () => {
    it("persists only the hash and returns the plaintext for the email link", async () => {
      update.mockResolvedValue({});

      const plaintext = await createResetToken("u1");

      expect(update).toHaveBeenCalledTimes(1);
      const arg = update.mock.calls[0][0];

      expect(arg.where).toEqual({ id: "u1" });
      // The whole point: what lands in the DB is the hash, never the token.
      expect(arg.data.reset_token).toBe(hashToken(plaintext));
      expect(arg.data.reset_token).not.toBe(plaintext);
      expect(arg.data.reset_token_expires).toBeInstanceOf(Date);
    });
  });

  describe("consumeResetToken", () => {
    it("looks up by hash and writes password + revocation in one statement", async () => {
      updateMany.mockResolvedValue({ count: 1 });

      const ok = await consumeResetToken("plaintext-token", "bcrypt-hash");

      expect(ok).toBe(true);
      const arg = updateMany.mock.calls[0][0];

      expect(arg.where.reset_token).toBe(hashToken("plaintext-token"));
      expect(arg.where.reset_token_expires.gt).toBeInstanceOf(Date);
      expect(arg.data.password).toBe("bcrypt-hash");
      expect(arg.data.reset_token).toBeNull();
      expect(arg.data.token_version).toEqual({ increment: 1 });
    });

    it("reports failure when the token was already used (count 0)", async () => {
      // The loser of two concurrent submissions matches zero rows.
      updateMany.mockResolvedValue({ count: 0 });

      expect(await consumeResetToken("used", "hash")).toBe(false);
    });
  });
});
