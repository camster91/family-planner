/** Source for the consolidated disposable-DB run; never a production fixture. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  persistInventoryIntake,
  INVENTORY_INTAKE_ACTION,
} from "@/lib/inventory-intake";
import {
  inventoryIntakeInput,
  type InventoryIntakeInput,
} from "@/lib/inventory-intake-contract";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("private food recognition plus canonical stock", () => {
  const family = `fx_food_${crypto.randomUUID()}`,
    other = `${family}_other`,
    user = `${family}_parent`;
  const actor = { userId: user, familyId: family, tokenVersion: 0 };
  const barcode = "00036000291452";
  const body = () =>
    inventoryIntakeInput.parse({
      protocol: "herewoven.inventory-intake.v1",
      expected_user_id: user,
      expected_family_id: family,
      issued_at: new Date().toISOString(),
      item: {
        name: "Our beans",
        amount: 2,
        unit: "packages",
        location: "pantry",
      },
      product: {
        barcode,
        brand: "Our brand",
        package_size: "500 g",
        origin: "manual",
        remember: true,
        base_revision: null,
      },
    });
  async function create(input: InventoryIntakeInput) {
    const receipt = await prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${user}`,
        key: crypto.randomUUID(),
        user_id: user,
        family_id: family,
        action: INVENTORY_INTAKE_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_INTAKE_ACTION, input),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
    return persistInventoryIntake(prisma!, actor, input, receipt.id);
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.createMany({
      data: [
        { id: family, name: "Food fixture", features: { inventory: true } },
        { id: other, name: "Other fixture" },
      ],
    });
    await prisma!.user.create({
      data: {
        id: user,
        family_id: family,
        role: "parent",
        name: "Fixture parent",
        email: `${user}@example.invalid`,
      },
    });
  });
  beforeEach(async () => {
    await prisma!.inventoryItem.deleteMany({ where: { family_id: family } });
    await prisma!.foodProduct.deleteMany({
      where: { family_id: { in: [family, other] } },
    });
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({ where: { id: { in: [family, other] } } });
    await prisma!.user.deleteMany({ where: { id: user } });
    await prisma!.$disconnect();
  });
  it("stores private corrections and separate lots without sharing another household's identity", async () => {
    await prisma!.foodProduct.create({
      data: { family_id: other, barcode, name: "Other household secret name" },
    });
    const first = await create(body());
    expect(first.status).toBe(201);
    const saved = await prisma!.foodProduct.findUniqueOrThrow({
      where: { family_id_barcode: { family_id: family, barcode } },
    });
    expect(saved.name).toBe("Our beans");
    expect(saved.revision).toBe(0);
    expect((await create(body())).status).toBe(201);
    expect(
      await prisma!.inventoryItem.count({
        where: { family_id: family, barcode },
      }),
    ).toBe(2);
    expect(
      (
        await prisma!.foodProduct.findUniqueOrThrow({
          where: { family_id_barcode: { family_id: other, barcode } },
        })
      ).name,
    ).toBe("Other household secret name");
  });
  it("refuses stale changed corrections before creating stock and accepts an explicit refreshed revision", async () => {
    await create(body());
    const beforeCount = await prisma!.inventoryItem.count({
      where: { family_id: family },
    });
    const input = body();
    input.item.name = "Changed family label";
    expect((await create(input)).body).toEqual({
      error: { code: "PRODUCT_CHANGED" },
    });
    expect(
      await prisma!.inventoryItem.count({ where: { family_id: family } }),
    ).toBe(beforeCount);
    input.product!.base_revision = 0;
    expect((await create(input)).status).toBe(201);
    expect(
      (
        await prisma!.foodProduct.findUniqueOrThrow({
          where: { family_id_barcode: { family_id: family, barcode } },
        })
      ).revision,
    ).toBe(1);
    const oldStock = await prisma!.inventoryItem.findFirstOrThrow({
      where: { family_id: family },
      orderBy: { created_at: "asc" },
    });
    expect(oldStock.name).toBe("Our beans");
    expect(oldStock.package_size).toBe("500 g");
    expect(oldStock.amount).toBe(2);
  });
});
