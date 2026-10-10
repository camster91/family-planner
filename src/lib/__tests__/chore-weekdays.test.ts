jest.mock('@/lib/prisma', () => ({ prisma: null }))
import { nextSelectedWeekday } from '@/lib/chore-weekdays'
import { nextDueDate, expandSeriesInTx, applyFrequencyEditInTx } from '@/lib/recurringChores'
import { createChoreSchema, updateChoreSchema } from '@/lib/validations'
const day = (date: string) => new Date(date + 'T00:00:00Z')

it('supports one or multiple weekdays across week/year boundaries', () => {
  expect(nextDueDate(day('2026-10-12'), 'weekly', [1,4])?.toISOString()).toBe('2026-10-15T00:00:00.000Z')
  expect(nextDueDate(day('2026-10-15'), 'weekly', [1,4])?.toISOString()).toBe('2026-10-19T00:00:00.000Z')
  expect(nextDueDate(day('2026-12-31'), 'weekly', [1])?.toISOString()).toBe('2027-01-04T00:00:00.000Z')
  expect(nextDueDate(day('2026-10-12'), 'weekly', [])?.toISOString()).toBe('2026-10-19T00:00:00.000Z')
})
it('anchors the first occurrence inclusively on or after the start date', () => {
  expect(nextSelectedWeekday(day('2026-10-11'),[1,4],true)?.toISOString()).toBe('2026-10-12T00:00:00.000Z')
  expect(nextSelectedWeekday(day('2026-10-12'),[1,4],true)?.toISOString()).toBe('2026-10-12T00:00:00.000Z')
})
it('rejects empty/duplicate/out-of-range or non-weekly choices while preserving legacy clients', () => {
  const base = { title:'Trash', assigned_to:'kid', due_date:'2026-10-12', frequency:'weekly' }
  expect(createChoreSchema.safeParse(base).success).toBe(true)
  for (const days of [[],[1,1],[-1],[7],[1.5]]) expect(createChoreSchema.safeParse({...base, weekly_days:days}).success).toBe(false)
  expect(createChoreSchema.safeParse({...base,frequency:'daily',weekly_days:[1]}).success).toBe(false)
  expect(updateChoreSchema.safeParse({choreId:'c',weekly_days:[1],frequency:'weekly'}).success).toBe(true)
  expect(updateChoreSchema.safeParse({choreId:'c',weekly_days:[1]}).success).toBe(false)
})
it('expands a bounded four-week multi-day window and is idempotent', async () => {
  const original = { id:'t',family_id:'f',frequency:'weekly',weekly_days:[1,4],due_date:day('2026-10-12'),rotation_member_ids:[],title:'Trash',description:null,points:10,difficulty:'easy',assigned_to:'kid',created_by:'parent',icon:null,routine:null,routine_order:null }
  const rows: any[] = [{due_date:original.due_date}]
  const tx: any = {chore:{findUnique:async()=>original, findMany:async()=>rows, findFirst:async()=>rows[rows.length-1], createMany:async({data}:any)=>{rows.push(...data);return {count:data.length}}}}
  expect(await expandSeriesInTx(tx,'t','f',day('2026-10-12'))).toBe(7)
  expect(rows.map(r=>r.due_date.toISOString().slice(0,10))).toEqual(['2026-10-12','2026-10-15','2026-10-19','2026-10-22','2026-10-26','2026-10-29','2026-11-02','2026-11-05'])
  expect(await expandSeriesInTx(tx,'t','f',day('2026-10-12'))).toBe(0)
  expect(await expandSeriesInTx(tx,'t','foreign',day('2026-10-12'))).toBe(0)
})


it('replans an unchanged weekly frequency when days change, preserving the history policy', async () => {
  const updates: any[] = [], deletes: any[] = []
  const template = {id:'t',frequency:'weekly',weekly_days:[1]}
  const tx: any = {chore:{findFirst:async()=>template,update:async (args:any)=>{updates.push(args)},deleteMany:async(args:any)=>{deletes.push(args);return {count:0}},findUnique:async()=>null}}
  await applyFrequencyEditInTx(tx,{id:'copy',family_id:'f',frequency:'once',recurrence_id:'t'},'weekly',{applyToSeries:true,weeklyDays:[1,4],now:day('2026-10-12')})
  expect(updates[0]).toMatchObject({where:{id:'t'},data:{frequency:'weekly',weekly_days:[1,4],is_template:true}})
  expect(deletes[0].where).toMatchObject({family_id:'f',recurrence_id:'t',status:'pending',id:{notIn:['t','copy']},due_date:{gte:day('2026-10-13')}})
})
