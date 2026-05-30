import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import BudgetDashboard from '@/components/budget/BudgetDashboard'

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
  category_breakdown: CategoryBreakdown[]
  recent_transactions: RecentTransaction[]
  monthly_trend: MonthlyTrend[]
}

export default async function BudgetPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    redirect('/login')
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, family_id: true, name: true, role: true },
  })

  if (!user?.family_id) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-semibold text-gray-900">No Family Yet</h2>
        <p className="text-gray-600 mt-2">
          Join or create a family to start tracking your budget.
        </p>
      </div>
    )
  }

  const familyId = user.family_id

  // Determine current month range
  const now = new Date()
  const targetYear = now.getFullYear()
  const targetMonth = now.getMonth() + 1
  const monthStart = new Date(targetYear, targetMonth - 1, 1)
  const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999)

  // 1. Aggregate income and expenses for the month
  const aggregations = await prisma!.transaction.groupBy({
    by: ['type'],
    where: {
      family_id: familyId,
      date: { gte: monthStart, lte: monthEnd },
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
      date: { gte: monthStart, lte: monthEnd },
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

  // 3. Recent transactions (last 10)
  const recentTransactions = await prisma!.transaction.findMany({
    where: { family_id: familyId },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
      user: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: { date: 'desc' },
    take: 10,
  })

  // 4. Monthly trend (last 6 months)
  const monthlyTrend: MonthlyTrend[] = []
  for (let i = 5; i >= 0; i--) {
    const trendDate = new Date(targetYear, targetMonth - 1 - i, 1)
    const tStart = new Date(trendDate.getFullYear(), trendDate.getMonth(), 1)
    const tEnd = new Date(trendDate.getFullYear(), trendDate.getMonth() + 1, 0, 23, 59, 59, 999)

    const monthAgg = await prisma!.transaction.groupBy({
      by: ['type'],
      where: {
        family_id: familyId,
        date: { gte: tStart, lte: tEnd },
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
      month: `${trendDate.getFullYear()}-${String(trendDate.getMonth() + 1).padStart(2, '0')}`,
      income: Math.round(mIncome * 100) / 100,
      expenses: Math.round(mExpenses * 100) / 100,
      balance: Math.round((mIncome - mExpenses) * 100) / 100,
    })
  }

  const data: BudgetPageData = {
    month: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
    total_income: Math.round(totalIncome * 100) / 100,
    total_expenses: Math.round(totalExpenses * 100) / 100,
    balance: Math.round(balance * 100) / 100,
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
      <BudgetDashboard initialData={data} userId={user.id} />
    </div>
  )
}
