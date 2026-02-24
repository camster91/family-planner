import { PlusCircle } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ChoreList from '@/components/chores/ChoreList'

export default async function ChoresPage() {
  const supabase = await createClient()
  
  // Get user and family data
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    return null
  }

  const { data: user } = await supabase
    .from('users')
    .select('*, family:families(*)')
    .eq('id', session.user.id)
    .single()

  // Get all chores for the family
  const { data: chores } = await supabase
    .from('chores')
    .select('*, assignee:users!chores_assigned_to_fkey(name), creator:users!chores_created_by_fkey(name)')
    .eq('family_id', user?.family_id)
    .order('due_date', { ascending: true })

  // Get family members for assignment
  const { data: familyMembers } = await supabase
    .from('users')
    .select('id, name, role, age')
    .eq('family_id', user?.family_id)
    .order('role', { ascending: false }) // Parents first

  const stats = {
    total: chores?.length || 0,
    completed: chores?.filter(c => c.status === 'completed' || c.status === 'verified').length || 0,
    pending: chores?.filter(c => c.status === 'pending' || c.status === 'in_progress').length || 0,
    overdue: chores?.filter(c => c.status === 'overdue').length || 0,
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Chores</h1>
          <p className="mt-2 text-gray-600">
            Manage household chores and responsibilities for your family.
          </p>
        </div>
        <Link
          href="/dashboard/chores/create"
          className="btn-primary inline-flex items-center"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          New Chore
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-sm text-gray-600">Total Chores</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-sm text-gray-600">Completed</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
          <div className="text-sm text-gray-600">Overdue</div>
        </div>
      </div>

      {/* Chore filters */}
      <div className="flex flex-wrap gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-full text-sm font-medium">
          All
        </button>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full text-sm font-medium">
          Pending
        </button>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full text-sm font-medium">
          In Progress
        </button>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full text-sm font-medium">
          Completed
        </button>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full text-sm font-medium">
          My Chores
        </button>
      </div>

      {/* Chore list */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">All Chores</h2>
          <div className="text-sm text-gray-600">
            {stats.completed} of {stats.total} completed ({stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%)
          </div>
        </div>

        {chores && chores.length > 0 ? (
          <ChoreList 
            chores={chores} 
            familyMembers={familyMembers || []}
            currentUserId={session.user.id}
          />
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <PlusCircle className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No chores yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Create your first chore to start tracking family responsibilities.
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