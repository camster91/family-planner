const mockFiles = new Map<string, Buffer>();
const mockRefusePairedDevice = jest.fn();
const mockRename = jest.fn();
let afterWriteFile: (() => void | Promise<void>) | undefined;

jest.mock("fs/promises", () => ({
  mkdir: async () => undefined,
  writeFile: async (filePath: string, bytes: Uint8Array) => {
    mockFiles.set(require("node:path").resolve(filePath), Buffer.from(bytes));
    await afterWriteFile?.();
  },
  rename: (...args: [string, string]) => mockRename(...args),
  link: async (from: string, to: string) => {
    const source = require("node:path").resolve(from);
    const target = require("node:path").resolve(to);
    const bytes = mockFiles.get(source);
    if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    if (mockFiles.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
    mockFiles.set(target, bytes);
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
import { POST as uploadAttachment } from "@/app/api/messages/attachments/route";
import { MESSAGE_ATTACHMENT_MAX_REQUEST_BYTES as MESSAGE_UPLOAD_MAX_REQUEST_BYTES } from "@/lib/message-attachments";
import {
  db,
  fakePrisma,
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
  as: "parentA" | "parentB" | "childA" = "parentA",
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
    afterWriteFile = undefined;
    mockRefusePairedDevice.mockReset();
    mockRefusePairedDevice.mockResolvedValue(null);
    mockRename.mockReset();
    mockRename.mockImplementation(async (from: string, to: string) => {
      const bytes = mockFiles.get(require("node:path").resolve(from));
      if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      mockFiles.delete(require("node:path").resolve(from));
      mockFiles.set(require("node:path").resolve(to), bytes);
    });
    db.tables.messageAttachment = [];
  });

  it("rejects explicit invalid or oversized Content-Length before parsing multipart input", async () => {
    const formData = jest.fn();
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

    expect((await uploadAttachment(invalid as never)).status).toBe(413);
    expect((await uploadAttachment(oversized as never)).status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("accepts a browser-style FormData body without Content-Length", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File([PNG], "message.png", { type: "image/png" }),
    );
    const native = new Request("http://localhost/api/messages/attachments", {
      method: "POST",
      body: formData,
      headers: { cookie: "session_token=session:parent-a" },
    });
    Object.defineProperty(native, "cookies", {
      value: {
        get: (name: string) =>
          name === "session_token" ? { value: "session:parent-a" } : undefined,
      },
    });

    expect(native.headers.get("content-length")).toBeNull();
    const response = await uploadAttachment(native as never);

    expect(response.status).toBe(201);
    expect(db.rows("messageAttachment")).toHaveLength(1);
  });

  it("bounds a chunked browser body when the proxy omits Content-Length", async () => {
    const native = new Request("http://localhost/api/messages/attachments", {
      method: "POST",
      headers: {
        cookie: "session_token=session:parent-a",
        "content-type": "multipart/form-data; boundary=unused",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new Uint8Array(MESSAGE_UPLOAD_MAX_REQUEST_BYTES + 1),
          );
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(native, "cookies", {
      value: {
        get: (name: string) =>
          name === "session_token" ? { value: "session:parent-a" } : undefined,
      },
    });

    expect(native.headers.get("content-length")).toBeNull();
    const response = await uploadAttachment(native as never);

    expect(response.status).toBe(413);
    expect(db.rows("messageAttachment")).toHaveLength(0);
  });

  it("returns the stored attachment and leaves only its final file after a valid upload", async () => {
    const response = await uploadAttachment(uploadReq() as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.attachment).toEqual(
      expect.objectContaining({
        url: expect.stringMatching(/^\/api\/messages\/attachments\//),
        size: PNG.length,
        type: "image/png",
      }),
    );
    expect(db.rows("messageAttachment")).toHaveLength(1);
    expect([...mockFiles.keys()]).toEqual([
      expect.stringMatching(/\/messages\/[a-f0-9]{32}\.png$/),
    ]);
    expect([...mockFiles.keys()].some((file) => file.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("deduplicates only an uploader's draft and isolates another member's identical upload", async () => {
    const first = await uploadAttachment(uploadReq("parentA") as never);
    const firstBody = await first.json();
    const sameUploader = await uploadAttachment(uploadReq("parentA") as never);
    const sameUploaderBody = await sameUploader.json();
    const otherMember = await uploadAttachment(uploadReq("childA") as never);
    const otherMemberBody = await otherMember.json();

    expect(first.status).toBe(201);
    expect(sameUploader.status).toBe(201);
    expect(otherMember.status).toBe(201);
    expect(sameUploaderBody.attachment.id).toBe(firstBody.attachment.id);
    expect(otherMemberBody.attachment.id).not.toBe(firstBody.attachment.id);
    expect(db.rows("messageAttachment")).toHaveLength(2);
    expect(db.rows("messageAttachment")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstBody.attachment.id,
          family_id: FAMILY_A,
          uploaded_by: "parent-a",
        }),
        expect.objectContaining({
          id: otherMemberBody.attachment.id,
          family_id: FAMILY_A,
          uploaded_by: "child-a",
        }),
      ]),
    );
    expect(db.rows("messageAttachment").every((row) => row.message_id == null)).toBe(
      true,
    );
  });

  it("removes the database row and temporary file when final placement fails", async () => {
    mockRename.mockRejectedValueOnce(new Error("disk full"));

    const response = await uploadAttachment(uploadReq() as never);

    expect(response.status).toBe(500);
    expect(db.rows("messageAttachment")).toHaveLength(0);
    expect(mockFiles.size).toBe(0);
  });

  it("does not delete or unlink an attachment claimed during a failed placement", async () => {
    let claimedId: string | undefined;
    afterWriteFile = () => {
      const row = db.rows("messageAttachment")[0];
      claimedId = row?.id;
      if (row) row.message_id = "message-claimed-during-upload";
    };
    mockRename.mockRejectedValueOnce(new Error("disk full"));

    const response = await uploadAttachment(uploadReq() as never);

    expect(response.status).toBe(500);
    expect(claimedId).toBeTruthy();
    expect(db.rows("messageAttachment")).toEqual([
      expect.objectContaining({
        id: claimedId,
        family_id: FAMILY_A,
        uploaded_by: "parent-a",
        message_id: "message-claimed-during-upload",
      }),
    ]);
    expect(mockFiles.size).toBe(0);
  });

  it("does not delete or unlink a row claimed after rename when verification fails", async () => {
    let claimedId: string | undefined;
    const originalFindUnique = fakePrisma.messageAttachment.findUnique;
    let calls = 0;
    const findUnique = jest
      .spyOn(fakePrisma.messageAttachment, "findUnique")
      .mockImplementation(async (args: any) => {
        calls += 1;
        if (calls === 2) {
          const row = db.rows("messageAttachment")[0];
          claimedId = row?.id;
          if (row) row.message_id = "message-claimed-after-rename";
          throw new Error("database unavailable");
        }
        return originalFindUnique(args);
      });

    try {
      const response = await uploadAttachment(uploadReq() as never);

      expect(response.status).toBe(500);
      expect(calls).toBe(2);
      expect(db.rows("messageAttachment")).toEqual([
        expect.objectContaining({
          id: claimedId,
          family_id: FAMILY_A,
          uploaded_by: "parent-a",
          message_id: "message-claimed-after-rename",
        }),
      ]);
      expect([...mockFiles.keys()]).toEqual([
        expect.stringMatching(/\/messages\/[a-f0-9]{32}\.png$/),
      ]);
    } finally {
      findUnique.mockRestore();
    }
  });

  it("removes its unclaimed row and final file when post-rename verification fails", async () => {
    const originalFindUnique = fakePrisma.messageAttachment.findUnique;
    let calls = 0;
    const findUnique = jest
      .spyOn(fakePrisma.messageAttachment, "findUnique")
      .mockImplementation(async (args: any) => {
        calls += 1;
        if (calls === 2) throw new Error("database unavailable");
        return originalFindUnique(args);
      });

    try {
      const response = await uploadAttachment(uploadReq() as never);

      expect(response.status).toBe(500);
      expect(calls).toBe(2);
      expect(db.rows("messageAttachment")).toHaveLength(0);
      expect(mockFiles.size).toBe(0);
    } finally {
      findUnique.mockRestore();
    }
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
