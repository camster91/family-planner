const mockFiles = new Map<string, Buffer>();
const mockRefusePairedDevice = jest.fn();

jest.mock("fs/promises", () => ({
  mkdir: async () => undefined,
  writeFile: async (filePath: string, bytes: Uint8Array) => {
    mockFiles.set(require("node:path").resolve(filePath), Buffer.from(bytes));
  },
  rename: async (from: string, to: string) => {
    const bytes = mockFiles.get(require("node:path").resolve(from));
    if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockFiles.delete(require("node:path").resolve(from));
    mockFiles.set(require("node:path").resolve(to), bytes);
  },
  unlink: async (filePath: string) => {
    mockFiles.delete(require("node:path").resolve(filePath));
  },
  readFile: async (filePath: string) => {
    const bytes = mockFiles.get(require("node:path").resolve(filePath));
    if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return bytes;
  },
}));
jest.mock("fs", () => ({
  existsSync: (filePath: string) =>
    mockFiles.has(require("node:path").resolve(filePath)),
}));
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/device-route", () => ({
  refusePairedDevice: (...args: unknown[]) => mockRefusePairedDevice(...args),
}));
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
}));
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: async (familyId: string) => {
    const { db } = require("@/__tests__/helpers/two-household");
    const family = db.find("family", familyId);
    if (family?.features?.messages === false) {
      const { NextResponse } = require("next/server");
      return NextResponse.json(
        { error: "This feature is turned off for your family" },
        { status: 403 },
      );
    }
    return null;
  },
}));

import path from "node:path";
import { GET as serveAttachment } from "@/app/api/messages/attachments/[id]/route";
import {
  POST as uploadAttachment,
  MESSAGE_UPLOAD_MAX_REQUEST_BYTES,
} from "@/app/api/messages/attachments/route";
import {
  db,
  FAMILY_A,
  FAMILY_B,
  req,
  params,
} from "@/__tests__/helpers/two-household";

process.env.UPLOAD_DIR = "/tmp/messages-route-test";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function uploadReq(
  as: "parentA" | "parentB" = "parentA",
  bytes = PNG,
  headers: Record<string, string> = {},
) {
  const formData = new FormData();
  formData.append(
    "file",
    new File([bytes], "message.png", { type: "image/png" }),
  );
  return {
    ...req({
      as,
      method: "POST",
      headers: {
        "content-length": String(bytes.byteLength + 1024),
        ...headers,
      },
    }),
    formData: async () => formData,
  };
}

describe("message attachment routes", () => {
  beforeEach(() => {
    db.reset();
    db.find("family", FAMILY_A)!.features = { messages: true };
    db.find("family", FAMILY_B)!.features = { messages: true };
    mockFiles.clear();
    mockRefusePairedDevice.mockReset();
    mockRefusePairedDevice.mockResolvedValue(null);
  });

  it("requires a valid bounded Content-Length before parsing multipart input", async () => {
    const formData = jest.fn();
    const missing = { ...req({ as: "parentA", method: "POST" }), formData };
    const invalid = {
      ...req({
        as: "parentA",
        method: "POST",
        headers: { "content-length": "nope" },
      }),
      formData,
    };
    const oversized = {
      ...req({
        as: "parentA",
        method: "POST",
        headers: {
          "content-length": String(MESSAGE_UPLOAD_MAX_REQUEST_BYTES + 1),
        },
      }),
      formData,
    };

    expect((await uploadAttachment(missing as never)).status).toBe(413);
    expect((await uploadAttachment(invalid as never)).status).toBe(413);
    expect((await uploadAttachment(oversized as never)).status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, paired-device, feature-off, and sniff-invalid uploads", async () => {
    const unauth = await uploadAttachment(uploadReq(null as never) as never);
    expect(unauth.status).toBe(401);

    mockRefusePairedDevice.mockResolvedValueOnce(
      require("next/server").NextResponse.json(
        { error: "Shared device cannot upload messages" },
        { status: 403 },
      ),
    );
    const paired = await uploadAttachment(uploadReq() as never);
    expect(paired.status).toBe(403);

    db.find("family", FAMILY_A)!.features = { messages: false };
    const disabled = await uploadAttachment(uploadReq() as never);
    expect(disabled.status).toBe(403);

    db.find("family", FAMILY_A)!.features = { messages: true };
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    const invalidImage = await uploadAttachment(
      uploadReq("parentA", html) as never,
    );
    expect(invalidImage.status).toBe(400);
    expect(db.rows("messageAttachment")).toHaveLength(0);
  });

  it("does not serve a draft attachment until the message claims it, while serving claimed rows only in-family", async () => {
    db.tables.messageAttachment = [];
    db.tables.messageAttachment.push(
      {
        id: "draft-a",
        family_id: FAMILY_A,
        uploaded_by: "parent-a",
        message_id: null,
        filename: `${"a".repeat(32)}.png`,
        content_type: "image/png",
        size_bytes: PNG.length,
      },
      {
        id: "claimed-a",
        family_id: FAMILY_A,
        uploaded_by: "parent-a",
        message_id: "msg-a",
        filename: `${"b".repeat(32)}.png`,
        content_type: "image/png",
        size_bytes: PNG.length,
      },
      {
        id: "claimed-b",
        family_id: FAMILY_B,
        uploaded_by: "parent-b",
        message_id: "msg-b",
        filename: `${"c".repeat(32)}.png`,
        content_type: "image/png",
        size_bytes: PNG.length,
      },
    );
    for (const filename of ["a", "b", "c"]) {
      mockFiles.set(
        path.join(
          "/tmp/messages-route-test",
          "messages",
          `${filename.repeat(32)}.png`,
        ),
        Buffer.from(PNG),
      );
    }

    expect(
      (
        await serveAttachment(
          req({ as: "parentA" }) as never,
          params({ id: "draft-a" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await serveAttachment(
          req({ as: "childA" }) as never,
          params({ id: "claimed-a" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await serveAttachment(
          req({ as: "parentB" }) as never,
          params({ id: "claimed-a" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await serveAttachment(
          req({ as: "parentB" }) as never,
          params({ id: "claimed-b" }),
        )
      ).status,
    ).toBe(200);
  });
});
