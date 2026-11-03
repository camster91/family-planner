jest.mock('@/lib/notification-delivery', () => ({ deliverNotification: jest.fn() }))
import { deliverNotification } from '@/lib/notification-delivery'
import { NotificationServiceServer } from '@/lib/notifications-server'

const deliver = jest.mocked(deliverNotification)
const service = new NotificationServiceServer()
const assignee = { id: 'child-a', name: 'Child' }
const parent = { id: 'parent-a', name: 'Parent' }
const chore = { id: 'chore-a', family_id: 'family-a', title: 'Pack bag', creator: parent }

beforeEach(() => {
  deliver.mockReset().mockResolvedValue({ delivered: false, notification: null })
})

it('connects assignment notifications to the exact chore without changing the recipient', async () => {
  await service.notifyChoreAssignment({ ...chore, due_date: '2026-11-03' }, assignee, parent)
  expect(deliver).toHaveBeenCalledTimes(1)
  expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'child-a', familyId: 'family-a', actionUrl: '/dashboard/chores?focus=chore-a',
  }))
})

it('keeps completion notices on the chore, including the reward-category acknowledgement', async () => {
  await service.notifyChoreCompletion(chore, assignee)
  expect(deliver).toHaveBeenCalledTimes(2)
  expect(deliver.mock.calls.map(([input]) => [input.userId, input.actionUrl])).toEqual([
    ['parent-a', '/dashboard/chores?focus=chore-a'],
    ['child-a', '/dashboard/chores?focus=chore-a'],
  ])
})

it('never converts malformed source identity into an arbitrary destination', async () => {
  await service.notifyChoreAssignment({ ...chore, id: '../settings', due_date: '2026-11-03' }, assignee, parent)
  expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: null }))
})
