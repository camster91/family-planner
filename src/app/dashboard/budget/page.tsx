import { financeArchiveReviewEnabled } from '@/lib/finance-archive-read'
import { HouseholdPageState } from '@/components/layout/DashboardRecoveryCopy'
import { getServerActor } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import BudgetDashboard from '@/components/budget/BudgetDashboard'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { utcMonthRange } from '@/lib/dates'
import { RECENT_TRANSACTIONS_LIMIT, sumBudgetLimits } from '@/lib/budget'
import { storageBackend } from '@/lib/storage-backend'
import { readD1BudgetStats } from '@/lib/cloudflare/budget'

export const dynamic = 'force-dynamic'

interface CategoryBreakdown {
  category_id: string | null
  name: string
  icon: string
  color: string
  budget_limit: number | null
  total: number
  percentage: number
}

interface RecentTransaction {
  id: string
  amount: number
  type: string
  description: string | null
  date: string
  is_recurring: boolean
  recurring_interval: string | null
  category: {
    id: string
    name: string
    icon: string
    color: string
  } | null
  user: {
    id: string
    name: string
    avatar_url: string | null
  }
}

interface MonthlyTrend {
  month: string
  income: number
  expenses: number
  balance: number
}

export interface BudgetPageData {
  month: string
  total_income: number
  total_expenses: number
  balance: number
  /** Sum of the household's expense-category limits; null when none is set. */
  budget_limit: number | null
  category_breakdown: CategoryBreakdown[]
  recent_transactions: RecentTransaction[]
  monthly_trend: MonthlyTrend[]
}

export default async function BudgetPage() {
  const sessionUser = await getServerActor()

  if (!sessionUser) {
    redirect('/login')
  }

  // Finance reads own their person/parent gate, independent of layout routing.
  if (sessionUser.role !== 'parent') redirect('/dashboard')

  if (!sessionUser.family_id) return <HouseholdPageState page="budget" />

  // The native runtime is authoritative when D1 is selected. Keep this
  // branch ahead of every Prisma read so a Cloudflare request cannot fall
  // through to an unavailable Postgres client.
  const now = new Date()
  const targetYear = now.getUTCFullYear()
  const targetMonth = now.getUTCMonth() + 1
  if (storageBackend() === 'd1') {
    const result = await readD1BudgetStats(
      {
        userId: sessionUser.id,
        familyId: sessionUser.family_id,
        role: sessionUser.role,
        generation: sessionUser.tokenVersion,
      },
      targetYear,
      targetMonth,
    )
    if (result.status === 401) redirect('/login')
    if (result.status === 403) return <FeatureOffState featureKey="budget" canManage />
    if (result.status !== 200) redirect('/dashboard')

    const body = result.body as any
    const data: BudgetPageData = {
      month: body.month,
      total_income: Number(body.total_income ?? 0),
      total_expenses: Number(body.total_expenses ?? 0),
      balance: Number(body.balance ?? 0),
      budget_limit: body.budget_limit == null ? null : Number(body.budget_limit),
      category_breakdown: (body.category_breakdown ?? []) as CategoryBreakdown[],
      recent_transactions: (body.recent_transactions ?? []).map((transaction: any) => ({
        ...transaction,
        date: new Date(transaction.date).toISOString(),
      })),
      monthly_trend: (body.monthly_trend ?? []).map((month: any) => ({
        ...month,
        balance: Math.round((Number(month.income ?? 0) - Number(month.expenses ?? 0)) * 100) / 100,
      })),
    }
    return <BudgetDashboard initialData={data} userId={sessionUser.id} canEdit archiveReviewEnabled={financeArchiveReviewEnabled()} />
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      family_id: true,
      name: true,
      role: true,
      token_version: true,
      family: { select: { features: true } },
    },
  })

  if (!user || user.token_version !== sessionUser.tokenVersion) redirect('/login')
  if (user.role !== 'parent' || user.family_id !== sessionUser.family_id) redirect('/dashboard')
  if (!user.family_id) return <HouseholdPageState page="budget" />

  // Server-side gate (route inventory F-2): with Budget off, no transaction or
  // category is read, rendered or serialised. The APIs are gated the same way.
  if (!isFeatureEnabled(normalizeFeatures(user.family?.features), 'budget')) {
    return <FeatureOffState featureKey="budget" canManage={true} />
  }

  const familyId = user.family_id

  // Current UTC calendar month, the same window `/api/budget/stats` uses
  // (server UTC, O-31). Transaction dates are date-only values at UTC midnight.
  const { start: monthStart, end: monthEnd } = utcMonthRange(targetYear, targetMonth)

  // 1. Aggregate income and expenses for the month
  const aggregations = await prisma!.transaction.groupBy({
    by: ['type'],
    where: {
      family_id: familyId,
      date: { gte: monthStart, lt: monthEnd },
    },
    _sum: { amount: true },
  })

  let totalIncome = 0
  let totalExpenses = 0

  for (const agg of aggregations) {
    const sum = agg._sum.amount || 0
    if (agg.type === 'income') totalIncome += sum
    else if (agg.type === 'expense') totalExpenses += sum
  }

  const balance = totalIncome - totalExpenses

  // 2. Category breakdown for expenses
  const categoryBreakdownRaw = await prisma!.transaction.groupBy({
    by: ['category_id'],
    where: {
      family_id: familyId,
      type: 'expense',
      date: { gte: monthStart, lt: monthEnd },
    },
    _sum: { amount: true },
  })

  const categoryIds = categoryBreakdownRaw
    .map((c) => c.category_id)
    .filter(Boolean) as string[]

  const categoryMap = new Map<string, { name: string; icon: string; color: string; budget_limit: number | null }>()

  if (categoryIds.length > 0) {
    const categories = await prisma!.budgetCategory.findMany({
      where: { id: { in: categoryIds }, family_id: familyId },
      select: { id: true, name: true, icon: true, color: true, budget_limit: true },
    })
    for (const cat of categories) {
      categoryMap.set(cat.id, cat)
    }
  }

  const categoryBreakdown: CategoryBreakdown[] = categoryBreakdownRaw.map((entry) => {
    const cat = entry.category_id ? categoryMap.get(entry.category_id) : null
    const total = entry._sum.amount || 0
    const percentage = totalExpenses > 0 ? (total / totalExpenses) * 100 : 0
    return {
      category_id: entry.category_id,
      name: cat?.name || 'Uncategorized',
      icon: cat?.icon || '📦',
      color: cat?.color || '#6B7280',
      budget_limit: cat?.budget_limit ?? null,
      total: Math.round(total * 100) / 100,
      percentage: Math.round(percentage * 10) / 10,
    }
  })

  categoryBreakdown.sort((a, b) => b.total - a.total)

  // Household limit: sum of every expense category's budget_limit (null when
  // none is set, and the dashboard then shows only what was spent).
  const limitCategories = await prisma!.budgetCategory.findMany({
    where: { family_id: familyId, type: 'expense' },
    select: { budget_limit: true },
  })
  const budgetLimit = sumBudgetLimits(limitCategories)

  // 3. Recent transactions (same count as `/api/budget/stats`)
  const recentTransactions = await prisma!.transaction.findMany({
    where: { family_id: familyId },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
      user: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: { date: 'desc' },
    take: RECENT_TRANSACTIONS_LIMIT,
  })

  // 4. Monthly trend (last 6 months)
  const monthlyTrend: MonthlyTrend[] = []
  for (let i = 5; i >= 0; i--) {
    const { start: tStart, end: tEnd } = utcMonthRange(targetYear, targetMonth - i)

    const monthAgg = await prisma!.transaction.groupBy({
      by: ['type'],
      where: {
        family_id: familyId,
        date: { gte: tStart, lt: tEnd },
      },
      _sum: { amount: true },
    })

    let mIncome = 0
    let mExpenses = 0
    for (const agg of monthAgg) {
      const sum = agg._sum.amount || 0
      if (agg.type === 'income') mIncome += sum
      else if (agg.type === 'expense') mExpenses += sum
    }

    monthlyTrend.push({
      month: `${tStart.getUTCFullYear()}-${String(tStart.getUTCMonth() + 1).padStart(2, '0')}`,
      income: Math.round(mIncome * 100) / 100,
      expenses: Math.round(mExpenses * 100) / 100,
      balance: Math.round((mIncome - mExpenses) * 100) / 100,
    })
  }

  // Async aggregates must not serialize into a retired parent/household session.
  // This renews the original actor; it never adopts a newer account generation
  // or switches the household whose rows were read. Runtime race acceptance is
  // still required; this is a final authority check, not a lock-based snapshot.
  const current = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true, token_version: true, family: { select: { features: true } } },
  })
  if (!current || current.token_version !== sessionUser.tokenVersion) redirect('/login')
  if (current.role !== 'parent' || current.family_id !== familyId) redirect('/dashboard')
  if (!isFeatureEnabled(normalizeFeatures(current.family?.features), 'budget')) {
    return <FeatureOffState featureKey="budget" canManage={true} />
  }

  const data: BudgetPageData = {
    month: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
    total_income: Math.round(totalIncome * 100) / 100,
    total_expenses: Math.round(totalExpenses * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    budget_limit: budgetLimit,
    category_breakdown: categoryBreakdown,
    recent_transactions: recentTransactions.map((t) => ({
      ...t,
      date: t.date.toISOString(),
      created_at: undefined as never,
      updated_at: undefined as never,
    })),
    monthly_trend: monthlyTrend,
  }

  return (
    <div>
      <BudgetDashboard initialData={data} userId={user.id} canEdit={user.role === 'parent'} archiveReviewEnabled={financeArchiveReviewEnabled()} />
    </div>
  )
}
