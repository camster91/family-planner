import { hashToken } from "@/lib/tokens";
import {
  sendTransactionalEmail,
  transactionalEmailStatus,
  verificationEmail,
} from "@/lib/transactional-email";

const originalEnv = { ...process.env };

describe("transactional email and one-time tokens", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("stores a deterministic digest instead of the bearer token", () => {
    const raw = "one-time-secret-token";
    expect(hashToken(raw)).toHaveLength(64);
    expect(hashToken(raw)).not.toBe(raw);
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("escapes user-controlled values in verification email HTML", () => {
    const email = verificationEmail(
      "<script>alert(1)</script>",
      "https://example.test/?a=1&b=2",
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("a=1&amp;b=2");
  });

  it("fails closed when production delivery is unconfigured", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.MATON_API_KEY;
    delete process.env.MATON_API_KEY_ASHBI;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_DELIVERY_MODE;
    expect(transactionalEmailStatus()).toBe("missing");
    await expect(
      sendTransactionalEmail({
        to: "person@example.test",
        subject: "Test",
        html: "<p>Test</p>",
      }),
    ).rejects.toThrow("not configured");
  });

  it("uses explicit log delivery without calling a network provider", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.CI = "true";
    process.env.EMAIL_DELIVERY_MODE = "log";
    const fetchSpy = jest.spyOn(global, "fetch");
    await expect(
      sendTransactionalEmail({
        to: "person@example.test",
        subject: "Test",
        html: "<p>Test</p>",
      }),
    ).resolves.toBe("log");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
