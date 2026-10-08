import {
  DEVICE_BOARD_MAX_AGE_MS,
  readDeviceBoardCache,
  writeDeviceBoardCache,
  type BoardCacheStorage,
} from "@/lib/device-board-cache";

const now = Date.parse("2026-10-08T11:00:00Z");
function store() {
  const values = new Map<string, string>();
  const storage: BoardCacheStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
}
function board() {
  return {
    generatedAt: new Date(now).toISOString(),
    members: [
      {
        id: "member-a",
        name: "Review member",
        email: "PRIVATE_EMAIL",
        token: "PRIVATE_TOKEN",
      },
    ],
    events: [
      {
        id: "event-a",
        title: "Shared event",
        start: new Date(now).toISOString(),
        end: new Date(now + 3600000).toISOString(),
        isTask: false,
        source: null,
        description: "PRIVATE_DESCRIPTION",
        address: "PRIVATE_ADDRESS",
      },
    ],
    chores: [
      {
        id: "chore-a",
        title: "Shared task",
        dueDay: "2026-10-08",
        status: "pending",
        assigneeId: "member-a",
        verification_notes: "PRIVATE_VERIFICATION",
      },
    ],
    dinners: [
      {
        id: "meal-a",
        day: "2026-10-08",
        recipeName: "Review dinner",
        cookName: null,
        notes: "PRIVATE_NOTES",
        missingIngredients: 42,
      },
    ],
    shopping: {
      items: [
        {
          id: "item-a",
          content: "Review apples",
          quantity: 1,
          listId: "list-a",
          listName: "Groceries",
          price: "PRIVATE_PRICE",
        },
      ],
      total: 1,
    },
    links: { calendar: "/dashboard/budget", features: "/dashboard/settings" },
    display: {
      idleMinutes: 5,
      night: { start: "22:00", end: "06:00" },
      photos: [{ id: "PRIVATE_PHOTO", url: "/private/photo" }],
    },
    weather: {
      label: "Review city",
      unit: "C",
      current: {
        temperature: 12,
        summary: "Clear",
        icon: "clear",
        isDay: true,
      },
      days: [],
      fetchedAt: new Date(now).toISOString(),
      coordinates: "PRIVATE_WEATHER_COORDINATES",
    },
    finance: "PRIVATE_FINANCE",
    elevationToken: "PRIVATE_ELEVATION",
  };
}

it("persists only the shared allowlist and can restore a fresh snapshot after restart", () => {
  const { storage, values } = store();
  expect(writeDeviceBoardCache(storage, "device-a", board(), now)).toBe(true);
  const raw = values.get("fp-device:v1:device-a:today")!;
  expect(raw).not.toContain("PRIVATE_");
  const restored = readDeviceBoardCache(storage, "device-a", now + 1000);
  expect(restored.state).toBe("ready");
  if (restored.state !== "ready") throw new Error("not restored");
  expect(restored.board.members[0].name).toBe("Review member");
  expect(restored.board.shopping?.items[0].content).toBe("Review apples");
  expect(
    Object.values(restored.board.links).every((link) => link === null),
  ).toBe(true);
  expect(restored.board.display?.photos).toBeUndefined();
  expect(restored.board.weather?.label).toBe("Review city");
  expect(restored.board.dinners?.[0].missingIngredients).toBeUndefined();
});

it("projects again when reading an older or poisoned stored envelope", () => {
  const { storage, values } = store();
  values.set(
    "fp-device:v1:device-a:today",
    JSON.stringify({
      v: 1,
      deviceId: "device-a",
      savedAt: now,
      board: board(),
      token: "PRIVATE_OUTER",
    }),
  );
  const result = readDeviceBoardCache(storage, "device-a", now);
  expect(result.state).toBe("ready");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
});

it.each([DEVICE_BOARD_MAX_AGE_MS, DEVICE_BOARD_MAX_AGE_MS + 1, -1])(
  "hides and removes expired or future-dated snapshots (offset %i)",
  (offset) => {
    const { storage, values } = store();
    expect(writeDeviceBoardCache(storage, "device-a", board(), now)).toBe(true);
    expect(readDeviceBoardCache(storage, "device-a", now + offset)).toEqual({
      state: "expired",
    });
    expect(values.size).toBe(0);
  },
);

it("does not share snapshots between device identities", () => {
  const { storage, values } = store();
  writeDeviceBoardCache(storage, "device-a", board(), now);
  expect(readDeviceBoardCache(storage, "device-b", now)).toEqual({
    state: "missing",
  });
  values.set(
    "fp-device:v1:device-b:today",
    values.get("fp-device:v1:device-a:today")!,
  );
  expect(readDeviceBoardCache(storage, "device-b", now)).toEqual({
    state: "invalid",
  });
});

it.each(["not json", JSON.stringify({ v: 2 }), "x".repeat(256 * 1024 + 1)])(
  "drops corrupt, unknown-version and oversized records",
  (raw) => {
    const { storage, values } = store();
    values.set("fp-device:v1:device-a:today", raw);
    expect(readDeviceBoardCache(storage, "device-a", now)).toEqual({
      state: "invalid",
    });
    expect(values.size).toBe(0);
  },
);

it("refuses malformed DTOs without claiming durability", () => {
  const { storage, values } = store();
  expect(
    writeDeviceBoardCache(
      storage,
      "device-a",
      { ...board(), members: [{ id: "invalid id", name: "No" }] },
      now,
    ),
  ).toBe(false);
  expect(values.size).toBe(0);
});

it("tolerates missing, inaccessible and quota-limited storage", () => {
  expect(readDeviceBoardCache(null, "device-a", now)).toEqual({
    state: "missing",
  });
  expect(writeDeviceBoardCache(null, "device-a", board(), now)).toBe(false);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readDeviceBoardCache(broken, "device-a", now)).toEqual({
    state: "invalid",
  });
  expect(writeDeviceBoardCache(broken, "device-a", board(), now)).toBe(false);
});
