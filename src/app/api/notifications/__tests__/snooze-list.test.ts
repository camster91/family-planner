jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/api-auth', () => ({authenticateRequest:jest.fn(async()=>[{userId:'user-a'},null])}))
jest.mock('@/lib/prisma', () => ({prisma:{notification:{findMany:jest.fn(async()=>[])}}}))
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'
beforeEach(()=>jest.clearAllMocks())
it('excludes future snoozes by default and includes expired at the boundary',async()=>{
 await GET({url:'http://localhost/api/notifications?unread=true'} as NextRequest)
 const {where}=(prisma!.notification.findMany as jest.Mock).mock.calls[0][0]
 expect(where.user_id).toBe('user-a')
 expect(where.read).toBe(false)
 expect(where.OR[0]).toEqual({snoozed_until:null})
 expect(where.OR[1].snoozed_until.lte).toBeInstanceOf(Date)
})
it('allows inbox to include snoozed rows without changing ownership',async()=>{
 await GET({url:'http://localhost/api/notifications?includeSnoozed=true'} as NextRequest)
 expect((prisma!.notification.findMany as jest.Mock).mock.calls[0][0].where).toEqual({user_id:'user-a'})
})
