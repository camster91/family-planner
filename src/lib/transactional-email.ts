type EmailProvider = "maton" | "resend" | "log";

type TransactionalEmail = {
  to: string;
  subject: string;
  html: string;
};

function configuredEmailFrom(): string | undefined {
  const value = process.env.EMAIL_FROM || process.env.FROM_EMAIL;
  return value?.trim() || undefined;
}

function emailFrom(): string {
  const configured = configuredEmailFrom();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Transactional email sender is not configured");
  }
  return "Family Planner <noreply@family.ashbi.ca>";
}

function assertSafeHeader(value: string) {
  if (/\r|\n/.test(value)) throw new Error("Invalid email header");
}

export function transactionalEmailStatus(): EmailProvider | "missing" {
  if (
    process.env.NODE_ENV !== "production" ||
    (process.env.EMAIL_DELIVERY_MODE === "log" && process.env.CI === "true")
  )
    return "log";
  if (!configuredEmailFrom()) return "missing";
  if (process.env.MATON_API_KEY || process.env.MATON_API_KEY_ASHBI)
    return "maton";
  if (process.env.RESEND_API_KEY) return "resend";
  return "missing";
}

export async function sendTransactionalEmail(
  email: TransactionalEmail,
): Promise<EmailProvider> {
  assertSafeHeader(email.to);
  assertSafeHeader(email.subject);

  const provider = transactionalEmailStatus();
  if (provider === "log") {
    if (process.env.NODE_ENV !== "production" && process.env.CI !== "true") {
      console.info(
        `Transactional email (development only): ${email.subject}\n${email.html}`,
      );
    } else {
      console.info(`Transactional email accepted in log mode: ${email.subject}`);
    }
    return provider;
  }
  if (provider === "missing") {
    throw new Error("Transactional email delivery is not configured");
  }

  const from = emailFrom();
  assertSafeHeader(from);

  if (provider === "maton") {
    const mime = [
      `From: ${from}`,
      `To: ${email.to}`,
      `Subject: ${email.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      email.html,
    ].join("\r\n");
    const raw = Buffer.from(mime).toString("base64url");
    const response = await fetch(
      "https://api.maton.ai/google-mail/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MATON_API_KEY || process.env.MATON_API_KEY_ASHBI}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Maton rejected transactional email (${response.status})`,
      );
    return provider;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Resend rejected transactional email (${response.status})`);
  return provider;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

export function verificationEmail(name: string, verifyUrl: string) {
  return {
    subject: "Verify Your Family Planner Email",
    html: [
      "<h2>Verify Your Email</h2>",
      `<p>Hi ${escapeHtml(name)},</p>`,
      "<p>Welcome to Family Planner. Verify your email address to get started.</p>",
      `<p><a href="${escapeHtml(verifyUrl)}">Verify Email</a></p>`,
      "<p>This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>",
    ].join("\n"),
  };
}

export function passwordResetEmail(name: string, resetUrl: string) {
  return {
    subject: "Reset Your Family Planner Password",
    html: [
      "<h2>Password Reset Request</h2>",
      `<p>Hi ${escapeHtml(name)},</p>`,
      "<p>You requested a password reset for your Family Planner account.</p>",
      `<p><a href="${escapeHtml(resetUrl)}">Reset Password</a></p>`,
      "<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>",
    ].join("\n"),
  };
}
