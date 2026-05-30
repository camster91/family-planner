import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET — Return budget summary stats for the current month
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const monthParam = searchParams.get('month') // optional: YYYY-MM override
    const yearParam = searchParams.get('year') // optional: YYYY override

    // Determine the target month range
    const now = new Date()
    const targetYear = yearParam ? parseInt(yearParam, 10) : now.getFullYear()
    const targetMonth = monthParam
      ? parseInt(monthParam, 10)
      : now.getMonth() + 1

    const monthStart = new Date(targetYear, targetMonth - 1, 1)
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999)

    const familyId = auth.user.family_id

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
      if (agg.type === 'income') {
        totalIncome = agg._sum.amount || 0
      } else if (agg.type === 'expense') {
        totalExpenses = agg._sum.amount || 0
      }
    }

    const balance = totalIncome - totalExpenses

    // 2. Category breakdown for expenses (current month)
    const categoryBreakdownRaw = await prisma!.transaction.groupBy({
      by: ['category_id'],
      where: {
        family_id: familyId,
        type: 'expense',
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amount: true },
    })

    // Fetch category details for the breakdown
    const categoryIds = categoryBreakdownRaw
      .map((c) => c.category_id)
      .filter(Boolean) as string[]

    const categories: Array<{ id: string; name: string; icon: string; color: string; budget_limit: number | null }> =
      categoryIds.length > 0
        ? await prisma!.budgetCategory.findMany({
            where: { id: { in: categoryIds }, family_id: familyId },
            select: { id: true, name: true, icon: true, color: true, budget_limit: true },
          }) as any
        : []

    const categoryMap = new Map(categories.map((c) => [c.id, c]))

    const categoryBreakdown = categoryBreakdownRaw.map((entry) => {
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

    // Sort by total descending
    categoryBreakdown.sort((a, b) => b.total - a.total)

    // 3. Recent transactions (last 5)
    const recentTransactions = await prisma!.transaction.findMany({
      where: { family_id: familyId },
      include: {
        category: {
          select: { id: true, name: true, icon: true, color: true },
        },
        user: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
      orderBy: { date: 'desc' },
      take: 5,
    })

    // 4. Monthly trend (last 6 months including current)
    const monthlyTrend: Array<{
      month: string
      income: number
      expenses: number
    }> = []

    for (let i = 5; i >= 0; i--) {
      const trendDate = new Date(targetYear, targetMonth - 1 - i, 1)
      const trendStart = new Date(trendDate.getFullYear(), trendDate.getMonth(), 1)
      const trendEnd = new Date(
        trendDate.getFullYear(),
        trendDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      )

      const monthAgg = await prisma!.transaction.groupBy({
        by: ['type'],
        where: {
          family_id: familyId,
          date: { gte: trendStart, lte: trendEnd },
        },
        _sum: { amount: true },
      })

      let monthIncome = 0
      let monthExpenses = 0

      for (const agg of monthAgg) {
        if (agg.type === 'income') {
          monthIncome = agg._sum.amount || 0
        } else if (agg.type === 'expense') {
          monthExpenses = agg._sum.amount || 0
        }
      }

      monthlyTrend.push({
        month: `${trendDate.getFullYear()}-${String(trendDate.getMonth() + 1).padStart(2, '0')}`,
        income: Math.round(monthIncome * 100) / 100,
        expenses: Math.round(monthExpenses * 100) / 100,
      })
    }

    return NextResponse.json({
      month: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
      total_income: Math.round(totalIncome * 100) / 100,
      total_expenses: Math.round(totalExpenses * 100) / 100,
      balance: Math.round(balance * 100) / 100,
      category_breakdown: categoryBreakdown,
      recent_transactions: recentTransactions,
      monthly_trend: monthlyTrend,
    })
  } catch (error) {
    console.error('Error fetching budget stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
