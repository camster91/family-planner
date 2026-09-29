/**
 * Database side of grocery store sections (#273). The pure rules live in
 * `src/lib/grocery-sections.ts`; this file reads and writes the household's
 * overrides (`GrocerySectionPreference`), `Ingredient.section`, the per-list
 * `List.sort_by_section` switch and the walking-order sessions
 * (`GroceryShoppingSession`).
 *
 * Every query is scoped by the caller's `family_id`; callers prove the
 * household (list or item lookup) before calling a writer.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  isGrocerySection,
  resolveGrocerySection,
  sectionNameKey,
  sectionOrder,
  type GrocerySectionId,
} from '@/lib/grocery-sections'
import { isGroceryListType } from '@/lib/grocery-display'

type Db = PrismaClient | Prisma.TransactionClient

/** The fields section resolution needs from one list row. */
export interface SectionRow {
  content: string
  ingredient?: { name?: string | null; section?: string | null } | null
}

/** Prisma `include` for the ingredient fields section resolution reads. */
export const SECTION_INGREDIENT_SELECT = { select: { name: true, section: true } } as const

/**
 * The household's overrides for the names on these rows, as `{ name_key:
 * section }`. Only keys present on the rows are read, so the payload stays
 * bounded by the list, not by the household's history.
 */
export async function loadSectionOverrides(
  db: Db,
  familyId: string,
  rows: ReadonlyArray<Pick<SectionRow, 'content'>>
): Promise<Record<string, GrocerySectionId>> {
  const keys = [...new Set(rows.map((r) => sectionNameKey(r.content)).filter(Boolean))]
  if (keys.length === 0) return {}
  const prefs = await db.grocerySectionPreference.findMany({
    where: { family_id: familyId, name_key: { in: keys } },
    select: { name_key: true, section: true },
  })
  const out: Record<string, GrocerySectionId> = {}
  for (const p of prefs) {
    // An unknown stored value (a future section id on an older server) is ignored.
    if (isGrocerySection(p.section)) out[p.name_key] = p.section
  }
  return out
}

/** Resolved section for each row, in order: override → ingredient section → keyword map → other. */
export function sectionsFor(rows: ReadonlyArray<SectionRow>, overrides: Record<string, string>): GrocerySectionId[] {
  return rows.map((r) =>
    resolveGrocerySection({
      override: overrides[sectionNameKey(r.content)],
      ingredientSection: r.ingredient?.section ?? null,
      name: r.content,
      ingredientName: r.ingredient?.name ?? null,
    })
  )
}

/** Rows with their resolved `section`, plus the overrides used (for the client). */
export async function withSections<T extends SectionRow>(
  db: Db,
  familyId: string,
  rows: readonly T[]
): Promise<{ rows: Array<T & { section: GrocerySectionId }>; overrides: Record<string, GrocerySectionId> }> {
  const overrides = await loadSectionOverrides(db, familyId, rows)
  const sections = sectionsFor(rows, overrides)
  return { rows: rows.map((r, i) => ({ ...r, section: sections[i] })), overrides }
}

// ---------------------------------------------------------------------------
// "Move to…"

export type MoveResult =
  | { ok: true; nameKey: string; override: GrocerySectionId | null; sections: Record<string, GrocerySectionId> }
  | { ok: false; status: 400 | 404; code: 'ITEM_NOT_FOUND' | 'LIST_NOT_GROCERY'; message: string }

/**
 * Sets (or with `section: null`, clears) the household's section for the
 * item's normalized name. When the row is linked to an ingredient of the
 * household, `Ingredient.section` follows, so the choice also holds for a
 * later recipe row whose text differs. Returns the resolved section of every
 * row on the same list that shares the name or the ingredient.
 */
export async function moveItemToSection(
  db: PrismaClient,
  input: { familyId: string; userId: string; itemId: string; section: GrocerySectionId | null }
): Promise<MoveResult> {
  const { familyId, userId, itemId, section } = input
  return db.$transaction(async (tx) => {
    const item = await tx.listItem.findFirst({
      where: { id: itemId, list: { family_id: familyId } },
      select: { id: true, list_id: true, content: true, ingredient_id: true, list: { select: { type: true } } },
    })
    if (!item) return { ok: false, status: 404, code: 'ITEM_NOT_FOUND', message: 'Item not found' } as const
    if (!isGroceryListType(item.list.type)) {
      return {
        ok: false,
        status: 400,
        code: 'LIST_NOT_GROCERY',
        message: 'Store sections are only for grocery and shopping lists.',
      } as const
    }
    const nameKey = sectionNameKey(item.content)
    if (!nameKey) return { ok: false, status: 404, code: 'ITEM_NOT_FOUND', message: 'Item not found' } as const

    if (section) {
      await tx.grocerySectionPreference.upsert({
        where: { family_id_name_key: { family_id: familyId, name_key: nameKey } },
        create: { family_id: familyId, name_key: nameKey, section, updated_by: userId },
        update: { section, updated_by: userId, updated_at: new Date() },
      })
    } else {
      await tx.grocerySectionPreference.deleteMany({ where: { family_id: familyId, name_key: nameKey } })
    }
    if (item.ingredient_id) {
      // Scoped by household again: a row can only point at its own household's
      // ingredient (ADR-0007), and this keeps it that way even if it did not.
      await tx.ingredient.updateMany({
        where: { id: item.ingredient_id, family_id: familyId },
        data: { section },
      })
    }

    const siblings = await tx.listItem.findMany({
      where: { list_id: item.list_id },
      select: { id: true, content: true, ingredient_id: true, ingredient: SECTION_INGREDIENT_SELECT },
    })
    const affected = siblings.filter(
      (r) => sectionNameKey(r.content) === nameKey || (item.ingredient_id != null && r.ingredient_id === item.ingredient_id)
    )
    const overrides = await loadSectionOverrides(tx, familyId, affected)
    const resolved = sectionsFor(affected, overrides)
    const sections: Record<string, GrocerySectionId> = {}
    affected.forEach((r, i) => {
      sections[r.id] = resolved[i]
    })
    return { ok: true, nameKey, override: section, sections } as const
  })
}

// ---------------------------------------------------------------------------
// Sort switch

export type SortResult =
  | { ok: true; listId: string; sortBySection: boolean }
  | { ok: false; status: 400 | 404; code: 'LIST_NOT_FOUND' | 'LIST_NOT_GROCERY'; message: string }

export async function setListSectionSort(
  db: PrismaClient,
  input: { familyId: string; listId: string; sortBySection: boolean }
): Promise<SortResult> {
  const list = await db.list.findFirst({
    where: { id: input.listId, family_id: input.familyId },
    select: { id: true, type: true },
  })
  if (!list) return { ok: false, status: 404, code: 'LIST_NOT_FOUND', message: 'List not found' }
  if (!isGroceryListType(list.type)) {
    return { ok: false, status: 400, code: 'LIST_NOT_GROCERY', message: 'Store sections are only for grocery and shopping lists.' }
  }
  const result = await db.list.updateMany({
    where: { id: list.id, family_id: input.familyId },
    data: { sort_by_section: input.sortBySection },
  })
  if (result.count === 0) return { ok: false, status: 404, code: 'LIST_NOT_FOUND', message: 'List not found' }
  return { ok: true, listId: list.id, sortBySection: input.sortBySection }
}

// ---------------------------------------------------------------------------
// Walking order

/** Ticks on one list further apart than this start a new shopping trip. */
export const SHOPPING_SESSION_GAP_MS = 2 * 60 * 60 * 1000
/** Recent trips read to learn the order. */
export const WALKING_ORDER_SESSIONS_READ = 20
/** Trips older than this are removed when a new one starts (no scheduled job). */
export const SHOPPING_SESSION_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

/** The household's section order: learned from recent trips, else the fixed order. */
export async function loadSectionOrder(db: Db, familyId: string) {
  const sessions = await db.groceryShoppingSession.findMany({
    where: { family_id: familyId },
    orderBy: { last_tick_at: 'desc' },
    take: WALKING_ORDER_SESSIONS_READ,
    select: { sections: true },
  })
  return sectionOrder(sessions.map((s) => s.sections ?? []))
}

/**
 * Called after a row on a grocery/shopping list changes from open to ticked
 * (PATCH /api/lists/items/update). Appends the row's section to the list's
 * current trip, or starts a trip. Serialised per list with a transaction-level
 * advisory lock so two quick ticks cannot start two trips. Stores section ids
 * only. Returns false when nothing was recorded (not a grocery list, no row).
 */
export async function recordSectionTick(
  db: PrismaClient,
  input: { familyId: string; itemId: string; at: Date }
): Promise<boolean> {
  const { familyId, itemId, at } = input
  return db.$transaction(async (tx) => {
    const item = await tx.listItem.findFirst({
      where: { id: itemId, list: { family_id: familyId } },
      select: { list_id: true, content: true, ingredient: SECTION_INGREDIENT_SELECT, list: { select: { type: true } } },
    })
    if (!item || !isGroceryListType(item.list.type)) return false
    const overrides = await loadSectionOverrides(tx, familyId, [item])
    const [section] = sectionsFor([item], overrides)

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'grocery-walk:' + item.list_id}))`
    const current = await tx.groceryShoppingSession.findFirst({
      where: {
        family_id: familyId,
        list_id: item.list_id,
        last_tick_at: { gte: new Date(at.getTime() - SHOPPING_SESSION_GAP_MS) },
      },
      orderBy: { last_tick_at: 'desc' },
      select: { id: true, sections: true, last_tick_at: true },
    })
    if (current) {
      const sections = current.sections ?? []
      await tx.groceryShoppingSession.update({
        where: { id: current.id },
        data: {
          sections: sections.includes(section) ? sections : [...sections, section],
          last_tick_at: at > current.last_tick_at ? at : current.last_tick_at,
        },
      })
      return true
    }
    await tx.groceryShoppingSession.deleteMany({
      where: { family_id: familyId, last_tick_at: { lt: new Date(at.getTime() - SHOPPING_SESSION_RETENTION_MS) } },
    })
    await tx.groceryShoppingSession.create({
      data: { family_id: familyId, list_id: item.list_id, sections: [section], started_at: at, last_tick_at: at },
    })
    return true
  })
}
