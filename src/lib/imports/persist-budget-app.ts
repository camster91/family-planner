import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planBudgetAppImport, type BudgetAppImportPlan } from "./budget-app";

const SOURCE_APP = "budget-app";
type Summary = {
  created: Record<string, number>;
  reused: Record<string, number>;
  skipped: Array<{ sourceModel: string; sourceId: string; reason: string }>;
};
const increment = (bucket: Record<string, number>, model: string) => {
  bucket[model] = (bucket[model] ?? 0) + 1;
};

export async function importBudgetApp(
  input: unknown,
  options: {
    familyId: string;
    startedBy: string;
    dryRun?: boolean;
  },
): Promise<{
  plan: BudgetAppImportPlan;
  summary: Summary;
  jobId: string | null;
}> {
  const plan = planBudgetAppImport(input, options.startedBy);
  const summary: Summary = {
    created: {},
    reused: {},
    skipped: [...plan.skippedRecords],
  };
  if (options.dryRun !== false) return { plan, summary, jobId: null };
  if (!prisma) throw new Error("Database is not configured");
  const job = await prisma.importJob.create({
    data: {
      family_id: options.familyId,
      source_app: SOURCE_APP,
      source_version: plan.sourceVersion,
      status: "running",
      dry_run: false,
      started_by: options.startedBy,
    },
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        const prior = await tx.importedRecord.findMany({
          where: { family_id: options.familyId, source_app: SOURCE_APP },
        });
        const mappings = new Map(
          prior.map((record) => [
            `${record.source_model}:${record.source_id}`,
            record.target_id,
          ]),
        );
        const existing = (model: string, id: string) =>
          mappings.get(`${model}:${id}`);
        const track = async (
          sourceModel: string,
          sourceId: string,
          targetModel: string,
          targetId: string,
        ) => {
          await tx.importedRecord.create({
            data: {
              family_id: options.familyId,
              import_job_id: job.id,
              source_app: SOURCE_APP,
              source_model: sourceModel,
              source_id: sourceId,
              target_model: targetModel,
              target_id: targetId,
            },
          });
          mappings.set(`${sourceModel}:${sourceId}`, targetId);
        };
        for (const source of plan.categories) {
          if (existing("Category", source.sourceId)) {
            increment(summary.reused, "BudgetCategory");
            continue;
          }
          const target = await tx.budgetCategory.create({
            data: {
              family_id: options.familyId,
              name: source.name,
              icon: source.icon,
              color: source.color,
              type: source.type,
              created_by: source.createdBy,
              created_at: source.createdAt,
              import_metadata: source.metadata as Prisma.InputJsonValue,
            },
          });
          await track("Category", source.sourceId, "BudgetCategory", target.id);
          increment(summary.created, "BudgetCategory");
        }
        for (const source of plan.transactions) {
          if (existing("Transaction", source.sourceId)) {
            increment(summary.reused, "Transaction");
            continue;
          }
          const target = await tx.transaction.create({
            data: {
              family_id: options.familyId,
              user_id: source.userId,
              amount: source.amount,
              type: source.type,
              category_id: source.sourceCategoryId
                ? (existing("Category", source.sourceCategoryId) ?? null)
                : null,
              description: source.description,
              date: source.date,
              is_recurring: source.isRecurring,
              created_at: source.createdAt,
              import_metadata: source.metadata as Prisma.InputJsonValue,
            },
          });
          await track("Transaction", source.sourceId, "Transaction", target.id);
          increment(summary.created, "Transaction");
        }
        for (const source of plan.wishlistItems) {
          if (existing("WishlistItem", source.sourceId)) {
            increment(summary.reused, "WishlistItem");
            continue;
          }
          const target = await tx.wishlistItem.create({
            data: {
              family_id: options.familyId,
              requested_by: source.requestedBy,
              title: source.title,
              link: source.link,
              description: source.description,
              approx_price: source.approxPrice,
              status: source.status,
              created_at: source.createdAt,
            },
          });
          await track(
            "WishlistItem",
            source.sourceId,
            "WishlistItem",
            target.id,
          );
          increment(summary.created, "WishlistItem");
        }
        for (const source of plan.archive) {
          if (existing(source.sourceModel, source.sourceId)) {
            increment(summary.reused, "FinancialArchiveRecord");
            continue;
          }
          const target = await tx.financialArchiveRecord.upsert({
            where: {
              family_id_source_app_source_model_source_id: {
                family_id: options.familyId,
                source_app: SOURCE_APP,
                source_model: source.sourceModel,
                source_id: source.sourceId,
              },
            },
            update: { payload: source.payload as Prisma.InputJsonValue },
            create: {
              family_id: options.familyId,
              source_app: SOURCE_APP,
              source_model: source.sourceModel,
              source_id: source.sourceId,
              payload: source.payload as Prisma.InputJsonValue,
            },
          });
          await track(
            source.sourceModel,
            source.sourceId,
            "FinancialArchiveRecord",
            target.id,
          );
          increment(summary.created, "FinancialArchiveRecord");
        }
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            completed_at: new Date(),
            summary: summary as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        completed_at: new Date(),
        error:
          error instanceof Error ? error.message : "Unknown import failure",
      },
    });
    throw error;
  }
  return { plan, summary, jobId: job.id };
}
