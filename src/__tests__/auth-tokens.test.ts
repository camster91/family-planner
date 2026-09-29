// Regression tests for #183 (P0): reset/verify tokens must never be stored in
// plaintext, and consuming one must be a single-use, atomic claim.

const update = jest.fn()
const updateMany = jest.fn()
const findFirst = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get update() {
        return update;
      },
      get updateMany() {
        return updateMany;
      },
      get findFirst() {
        return findFirst;
      },
    },
  },
}));

import {
  hashToken,
  tokenMatch,
  createResetToken,
  consumeResetToken,
  consumeEmailVerificationToken,
  resetTokenExists,
} from "@/lib/tokens";

describe("token storage", () => {
  beforeEach(() => {
    update.mockReset();
    updateMany.mockReset();
    findFirst.mockReset();
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

      expect(arg.where.reset_token).toEqual(
        tokenMatch("plaintext-token"),
      );
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

  // PR #101 disposition D-1: the pre-hashing plaintext arm is gone. It let the
  // stored hash itself be submitted as a token (a DB reader could reset a
  // password during a live reset window); every pre-hashing token expired long
  // ago, so only sha256(token) matches now.
  describe("stored hash is never accepted as a token", () => {
    it("tokenMatch is exactly the hash of the submitted token", () => {
      expect(tokenMatch("t")).toBe(hashToken("t"));
    });

    it("consumeResetToken looks up only the hash (submitting the stored hash does not match it)", async () => {
      updateMany.mockResolvedValue({ count: 1 });
      const stored = hashToken("real-token");

      await consumeResetToken(stored, "bcrypt-hash");

      const { where } = updateMany.mock.calls[0][0];
      expect(where.reset_token).toBe(hashToken(stored));
      expect(where.reset_token).not.toBe(stored);
    });

    it("consumeEmailVerificationToken looks up only the hash", async () => {
      updateMany.mockResolvedValue({ count: 1 });
      const stored = hashToken("real-token");

      await consumeEmailVerificationToken(stored);

      const { where } = updateMany.mock.calls[0][0];
      expect(where.verify_token).toBe(hashToken(stored));
      expect(where.verify_token).not.toBe(stored);
      expect(where.verify_token_expires.gt).toBeInstanceOf(Date);
    });
  });

  // The reset endpoint is public and unauthenticated. hashing the password
  // before knowing the token is valid let anyone burn a cost-12 bcrypt round
  // (~250ms of CPU) per request with garbage input.
  describe("resetTokenExists", () => {
    it("is true when a live row matches", async () => {
      findFirst.mockResolvedValue({ id: "u1" });

      expect(await resetTokenExists("t")).toBe(true);

      const { where, select } = findFirst.mock.calls[0][0];
      expect(where.reset_token).toEqual(tokenMatch("t"));
      expect(where.reset_token_expires.gt).toBeInstanceOf(Date);
      // Must not pull the user row back — this is a cheap existence check.
      expect(select).toEqual({ id: true });
    });

    it("is false when nothing matches, so bcrypt is never reached", async () => {
      findFirst.mockResolvedValue(null);
      expect(await resetTokenExists("garbage")).toBe(false);
    });
  });
});
