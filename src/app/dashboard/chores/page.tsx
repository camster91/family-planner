import { PlusCircle, Download } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ChoreList from '@/components/chores/ChoreList'
import ExportButton from '@/components/common/ExportButton'

export default async function ChoresPage({
  searchParams,
}: {
  searchParams: { status?: string; assigned_to?: string }
}) {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  const familyId = user?.family_id || undefined

  // Build where clause from searchParams
  const where: Record<string, unknown> = { family_id: familyId }
  if (searchParams.status) {
    where.status = searchParams.status
  }
  if (searchParams.assigned_to) {
    where.assigned_to = searchParams.assigned_to
  }

  // Get all chores for the family (filtered)
  const chores = familyId ? await prisma!.chore.findMany({
    where,
    include: {
      assignee: { select: { name: true } },
      creator: { select: { name: true } }
    },
    orderBy: { due_date: 'asc' }
  }) : []

  // Get all chores for stats (unfiltered)
  const allChores = familyId ? await prisma!.chore.findMany({
    where: { family_id: familyId },
    select: { status: true },
  }) : []

  // Get family members for assignment
  const familyMembers = familyId ? await prisma!.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true, role: true, age: true },
    orderBy: { role: 'desc' }
  }) : []

  const stats = {
    total: allChores?.length || 0,
    completed: allChores?.filter(c => c.status === 'completed' || c.status === 'verified').length || 0,
    pending: allChores?.filter(c => c.status === 'pending' || c.status === 'in_progress').length || 0,
    overdue: allChores?.filter(c => c.status === 'overdue').length || 0,
  }

  const currentFilter = searchParams.status || 'all'
  const currentAssigned = searchParams.assigned_to || ''

  const filterButtonClass = (active: boolean) =>
    `px-4 py-2 rounded-full text-sm font-medium transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Chores</h1>
          <p className="mt-2 text-gray-600">
            Manage household chores and responsibilities for your family.
          </p>
        </div>
        <div className="flex gap-2">
          {chores && chores.length > 0 && (
            <ExportButton data={chores} filename="chores" label="Export" />
          )}
          <Link
            href="/dashboard/chores/create"
            className="btn-primary inline-flex items-center"
          >
            <PlusCircle className="w-5 h-5 mr-2" />
            New Chore
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link href="/dashboard/chores" className="card text-center hover:shadow-md transition-shadow">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-sm text-gray-600">Total Chores</div>
        </Link>
        <Link href="/dashboard/chores?status=completed" className="card text-center hover:shadow-md transition-shadow">
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-sm text-gray-600">Completed</div>
        </Link>
        <Link href="/dashboard/chores?status=pending" className="card text-center hover:shadow-md transition-shadow">
          <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </Link>
        <Link href="/dashboard/chores?status=overdue" className="card text-center hover:shadow-md transition-shadow">
          <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
          <div className="text-sm text-gray-600">Overdue</div>
        </Link>
      </div>

      {/* Chore filters */}
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/chores" className={filterButtonClass(currentFilter === 'all')}>
          All
        </Link>
        <Link href="/dashboard/chores?status=pending" className={filterButtonClass(currentFilter === 'pending')}>
          Pending
        </Link>
        <Link href="/dashboard/chores?status=in_progress" className={filterButtonClass(currentFilter === 'in_progress')}>
          In Progress
        </Link>
        <Link href="/dashboard/chores?status=completed" className={filterButtonClass(currentFilter === 'completed')}>
          Completed
        </Link>
        {sessionUser && (
          <Link
            href={`/dashboard/chores?assigned_to=${sessionUser.id}`}
            className={filterButtonClass(currentAssigned === sessionUser.id)}
          >
            My Chores
          </Link>
        )}
      </div>

      {/* Chore list */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            {currentFilter === 'all' ? 'All Chores' : `${currentFilter.replace('_', ' ')} Chores`}
          </h2>
          <div className="text-sm text-gray-600">
            {stats.completed} of {stats.total} completed ({stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%)
          </div>
        </div>

        {chores && chores.length > 0 ? (
          <ChoreList
            chores={chores as any}
            familyMembers={familyMembers as any || []}
            currentUserId={sessionUser.id}
          />
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <PlusCircle className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No chores found</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              {currentFilter !== 'all'
                ? 'No chores match the current filter. Try a different filter or create a new chore.'
                : 'Create your first chore to start tracking family responsibilities.'
              }
            </p>
            <Link
              href="/dashboard/chores/create"
              className="btn-primary"
            >
              Create Your First Chore
            </Link>
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Chore Management Tips</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Age-Appropriate Tasks</h4>
            <p className="text-sm text-gray-600">
              Assign chores based on age and ability. Younger children can handle simpler tasks.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Clear Instructions</h4>
            <p className="text-sm text-gray-600">
              Provide clear descriptions and expectations for each chore to avoid confusion.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Consistent Schedule</h4>
            <p className="text-sm text-gray-600">
              Set regular due dates to build consistency and establish routines.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}