jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/api-auth', () => ({ authenticateRequest: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: { notification: { updateMany: jest.fn() } } }))
import { PATCH } from '../snooze/route'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { req } from '@/__tests__/helpers/two-household'
const auth = authenticateRequest as jest.Mock
const write = prisma!.notification.updateMany as jest.Mock
beforeEach(() => { jest.useFakeTimers({now:new Date('2026-10-09T12:00:00Z')}); auth.mockResolvedValue([{userId:'user-a'},null]); write.mockReset(); write.mockImplementation(async ({where}) => ({count:where.id === 'note-a' && where.user_id === 'user-a' ? 1 : 0})) })
afterEach(() => jest.useRealTimers())
it.each([15,60,180,1440])('saves a %s minute delay only on the authenticated owner row', async minutes => {
 const r=await PATCH(req({body:{notificationId:'note-a',minutes}}))
 expect(r.status).toBe(200)
 expect(write).toHaveBeenCalledWith({where:{id:'note-a',user_id:'user-a'},data:{read:false,snoozed_until:new Date(Date.now()+minutes*60_000)}})
})
it('clears snooze idempotently without marking read', async()=>{
 for(let i=0;i<2;i++) expect((await PATCH(req({body:{notificationId:'note-a',minutes:null}}))).status).toBe(200)
 expect(write.mock.calls[0][0].data).toEqual({read:false,snoozed_until:null})
})
it('refuses another user row, including another household, without updating it',async()=>{
 expect((await PATCH(req({body:{notificationId:'note-b',minutes:60}}))).status).toBe(404)
 expect(write.mock.calls[0][0].where).toEqual({id:'note-b',user_id:'user-a'})
})
it.each([-1,0,16,999999,'60',undefined])('rejects unsupported duration %s',async minutes=>{
 expect((await PATCH(req({body:{notificationId:'note-a',minutes}}))).status).toBe(400)
 expect(write).not.toHaveBeenCalled()
})
it('requires authentication',async()=>{
 const {NextResponse}=require('next/server')
 auth.mockResolvedValue([null,NextResponse.json({error:'Unauthorized'},{status:401})])
 expect((await PATCH(req({body:{notificationId:'note-a',minutes:15}}))).status).toBe(401)
 expect(write).not.toHaveBeenCalled()
})
