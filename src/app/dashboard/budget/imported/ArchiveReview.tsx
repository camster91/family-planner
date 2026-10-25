'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui/dialog'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { useFinanceArchiveText } from '@/i18n/finance-archive'
import { FINANCE_ARCHIVE_MODELS, FINANCE_ARCHIVE_OWNER_HEADER, financeArchivePage, financeArchiveDetails, type FinanceArchiveDetails, type FinanceArchiveOwner, type FinanceArchivePage, type FinanceArchiveModel } from '@/lib/finance-archive-contract'
import { requestOwnedJson } from '@/lib/owned-request-http'
type Position = { model: FinanceArchiveModel | null; cursor: string | null }
export default function ArchiveReview({ owner }: { owner: FinanceArchiveOwner }) {
  const text = useFinanceArchiveText()
  const locale = useDisplayLocale()
  const [position, setPosition] = useState<Position>({ model: null, cursor: null })
  const [snapshot, setSnapshot] = useState<{ key: string; data: FinanceArchivePage } | null>(null)
  const [selected, setSelected] = useState<FinanceArchivePage['rows'][number] | null>(null)
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [retired, setRetired] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [detailSnapshot, setDetailSnapshot] = useState<{ key: string; value: FinanceArchiveDetails } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false), [detailFailed, setDetailFailed] = useState(false), [detailRefresh, setDetailRefresh] = useState(0)
  const seen = useRef(new Set<string>())
  const ownerKey = JSON.stringify(owner), requestKey = JSON.stringify({ owner, position })
  const data = snapshot?.key === requestKey && !retired ? snapshot.data : null
  useEffect(() => {
    if (retired) return
    const controller = new AbortController()
    let active = true
    setLoading(true); setFailed(false); setSelected(null)
    const params = new URLSearchParams()
    if (position.model) params.set('model', position.model)
    if (position.cursor) params.set('cursor', position.cursor)
    const query = params.toString()
    void (async () => {
      try {
        const result = await requestOwnedJson(`/api/budget/archive${query ? `?${query}` : ''}`, { headers: { [FINANCE_ARCHIVE_OWNER_HEADER]: ownerKey }, signal: controller.signal }, 128 * 1024)
        if (!active) return
        if (result.kind === 'unknown') { setFailed(true); return }
        if ([401, 403, 404, 409].includes(result.response.status)) { setRetired(true); setSnapshot(null); return }
        const parsed = result.response.ok ? financeArchivePage.safeParse(result.body) : null
        if (!parsed?.success || parsed.data.model !== position.model) { setFailed(true); return }
        const actual = parsed.data.owner
        if (actual.userId !== owner.userId || actual.familyId !== owner.familyId || actual.generation !== owner.generation) { setRetired(true); setSnapshot(null); return }
        if (parsed.data.nextCursor && (parsed.data.nextCursor === position.cursor || seen.current.has(parsed.data.nextCursor))) { setFailed(true); return }
        setSnapshot({ key: requestKey, data: parsed.data })
      } catch { if (active) setFailed(true) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false; controller.abort() }
  }, [requestKey, ownerKey, owner.userId, owner.familyId, owner.generation, position.model, position.cursor, refresh, retired])
  const detailKey = selected && data && !retired ? JSON.stringify({ requestKey, id: selected.id }) : null
  const detail = detailSnapshot?.key === detailKey ? detailSnapshot?.value : null
  useEffect(() => {
    if (!detailKey || !selected) return
    const id = selected.id
    const controller = new AbortController()
    let active = true
    setDetailLoading(true); setDetailFailed(false); setDetailSnapshot(null)
    void (async () => {
      try {
        const result = await requestOwnedJson(`/api/budget/archive?${new URLSearchParams({ recordId: id })}`, { headers: { [FINANCE_ARCHIVE_OWNER_HEADER]: ownerKey }, signal: controller.signal }, 32 * 1024)
        if (!active) return
        if (result.kind === 'unknown') { setDetailFailed(true); return }
        const code = result.body && typeof result.body === 'object' && 'code' in result.body ? result.body.code : null
        if ([401, 403, 409].includes(result.response.status) || (result.response.status === 404 && code !== 'RECORD_UNAVAILABLE')) { setRetired(true); setSnapshot(null); return }
        const parsed = result.response.ok ? financeArchiveDetails.safeParse(result.body) : null
        if (!parsed?.success || parsed.data.recordId !== id) { setDetailFailed(true); return }
        const actual = parsed.data.owner
        if (actual.userId !== owner.userId || actual.familyId !== owner.familyId || actual.generation !== owner.generation) { setRetired(true); setSnapshot(null); return }
        setDetailSnapshot({ key: detailKey, value: parsed.data })
      } catch { if (active) setDetailFailed(true) }
      finally { if (active) setDetailLoading(false) }
    })()
    return () => { active = false; controller.abort() }
  }, [detailKey, selected?.id, detailRefresh, ownerKey, owner.userId, owner.familyId, owner.generation])
  const changeType = (model: FinanceArchiveModel | null) => { seen.current.clear(); setSelected(null); setPosition({ model, cursor: null }) }
  return <div className="space-y-4 p-4 pb-24">
    <Link href="/dashboard/budget" className="btn-plain inline-flex min-h-[44px] items-center">{text('back')}</Link>
    <header><h1 className="text-large-title">{text('title')}</h1><p className="mt-2 max-w-2xl text-body text-label-secondary">{text('intro')}</p></header>
    {retired ? <p role="alert" className="card-apple p-4">{text('unavailable')}</p> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-footnote">{text('type')}<select className="input-apple mt-1 min-h-[44px] w-full" value={position.model ?? ''} disabled={loading} onChange={event => changeType(event.target.value === '' ? null : event.target.value as FinanceArchiveModel)}>
          <option value="">{text('all')}</option>{[...FINANCE_ARCHIVE_MODELS, 'other' as const].map(model => <option key={model} value={model}>{text(model)}{data ? ` (${data.counts.find(row => row.model === model)?.count ?? '0'})` : ''}</option>)}
        </select></label>
        <button type="button" className="btn-tinted min-h-[44px]" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{text('refresh')}</button>
      </div>
      {loading && <p role="status">{text('loading')}</p>}
      {failed && <div role="alert" className="card-apple p-4"><p>{text('failed')}</p><button type="button" className="btn-tinted mt-2 min-h-[44px]" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{text('retry')}</button></div>}
      {data && <>
        {!data.rows.length ? <p className="card-apple p-4">{text('empty')}</p> : <ul className="card-apple divide-y divide-separator overflow-hidden">{data.rows.map(row => <li key={row.id}><button type="button" className="w-full min-h-[44px] p-4 text-left focus-visible:outline focus-visible:outline-2" onClick={() => { setDetailSnapshot(null); setDetailFailed(false); setDetailLoading(true); setSelected(row) }}>
          <span className="block break-all font-semibold">{FINANCE_ARCHIVE_MODELS.includes(row.sourceModel as typeof FINANCE_ARCHIVE_MODELS[number]) ? text(row.sourceModel as typeof FINANCE_ARCHIVE_MODELS[number]) : text('other')}</span><span className="block break-all text-footnote text-label-secondary">{row.sourceApp} · {row.sourceId}</span>
        </button></li>)}</ul>}
        </>}
      <nav aria-label={text('title')} className="flex flex-wrap gap-3">
          {position.cursor && <button type="button" className="btn-tinted min-h-[44px]" disabled={loading} onClick={() => changeType(position.model)}>{text('newest')}</button>}
          {data?.nextCursor && <button type="button" className="btn-tinted min-h-[44px]" disabled={loading} onClick={() => { if (position.cursor) seen.current.add(position.cursor); setSelected(null); setPosition({ ...position, cursor: data.nextCursor }) }}>{text('next')}</button>}
        </nav>
    </>}
    <Dialog open={selected !== null && !retired && Boolean(data?.rows.some(row => row.id === selected.id))} onClose={() => setSelected(null)} title={text('details')} closeLabel={text('close')} variant="form">
      {selected && <div className="space-y-4"><dl className="space-y-3">{[
        [text('sourceApp'), selected.sourceApp], [text('sourceModel'), selected.sourceModel], [text('sourceId'), selected.sourceId],
        [text('preserved'), new Date(selected.createdAt).toLocaleString(locale)],
      ].map(([label, value]) => <div key={label}><dt className="text-footnote text-label-secondary">{label}</dt><dd className="break-all text-body">{value}</dd></div>)}</dl>
        {detailLoading && <p role="status">{text('detailLoading')}</p>}
        {detailFailed && <div role="alert"><p>{text('detailFailed')}</p><div className="mt-2 flex flex-wrap gap-3"><button type="button" className="btn-tinted min-h-[44px]" disabled={detailLoading} onClick={() => setDetailRefresh(value => value + 1)}>{text('retry')}</button><button type="button" className="btn-plain min-h-[44px]" onClick={() => { setSelected(null); setRefresh(value => value + 1) }}>{text('refresh')}</button></div></div>}
        {detail && <div className="space-y-3">
          <div><p className="text-footnote text-label-secondary">{text('fingerprint')}</p>{detail.fingerprint.state === 'available' ? <code className="block break-all text-footnote">{detail.fingerprint.sha256}</code> : <p className="text-footnote">{text(detail.fingerprint.state === 'too-large' ? 'fingerprintLarge' : 'fingerprintUnavailable')}</p>}<p className="mt-1 text-footnote text-label-secondary">{text('fingerprintHelp')}</p></div>
          <p className="text-footnote">{text(detail.provenance.state === 'matched' ? 'provenanceMatched' : 'provenanceUnavailable')}</p>
          <dl><dt className="text-footnote text-label-secondary">{text('sourceVersion')}</dt><dd className="break-all">{detail.provenance.sourceVersion ?? text('versionUnknown')}</dd></dl>
          {detail.provenance.versionTruncated && <p className="text-footnote">{text('versionShortened')}</p>}
        </div>}
        {selected.sourceLabelsTruncated && <p className="text-footnote">{text('shortened')}</p>}<p className="text-footnote text-label-secondary">{text('intro')}</p><Link className="btn-plain inline-flex min-h-[44px] items-center" href="/dashboard/settings">{text('exportHelp')}</Link>
      </div>}
    </Dialog>
  </div>
}
