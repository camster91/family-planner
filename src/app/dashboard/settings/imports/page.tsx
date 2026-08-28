'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Database, FileJson, Loader2, ShieldCheck } from 'lucide-react'

type Source = 'chore-champs' | 'meal-planner' | 'budget-app'

export default function FamilyImportsPage() {
  const [source, setSource] = useState<Source>('chore-champs')
  const [fileData, setFileData] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [identityMap, setIdentityMap] = useState('{}')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const resetPreview = () => {
    setResult(null)
    setConfirmed(false)
    setError('')
  }

  const handleFile = async (file: File | undefined) => {
    resetPreview()
    setFileData(null)
    setFileName('')
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError('Export files must be 10 MB or smaller.')
      return
    }
    try {
      setFileData(JSON.parse(await file.text()))
      setFileName(file.name)
    } catch {
      setError('That file is not valid JSON.')
    }
  }

  const runImport = async (dryRun: boolean) => {
    if (!fileData) return setError('Choose an export file first.')
    let parsedMap: unknown
    try {
      parsedMap = JSON.parse(identityMap)
    } catch {
      return setError('Identity mapping must be valid JSON.')
    }
    if (!parsedMap || Array.isArray(parsedMap) || typeof parsedMap !== 'object') {
      return setError('Identity mapping must be a JSON object.')
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/imports/${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: fileData, identityMap: parsedMap, dryRun }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Import failed')
      setResult(body)
      if (!dryRun) setConfirmed(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Back to settings
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Database className="w-8 h-8 text-violet-600" /> Import family apps
        </h1>
        <p className="mt-2 text-gray-600">Validate an export first, review skipped records, then explicitly approve persistence.</p>
      </div>

      <div className="card space-y-6">
        <div>
          <label htmlFor="importSource" className="block text-sm font-medium text-gray-700 mb-2">Source application</label>
          <select id="importSource" value={source} onChange={(event) => { setSource(event.target.value as Source); resetPreview() }} className="input-field w-full">
            <option value="chore-champs">ChoreChamps</option>
            <option value="meal-planner">Meal Planner</option>
            <option value="budget-app">Budget App</option>
          </select>
        </div>

        <div>
          <label htmlFor="importFile" className="block text-sm font-medium text-gray-700 mb-2">JSON export</label>
          <label htmlFor="importFile" className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 p-8 hover:border-violet-400">
            <FileJson className="w-6 h-6 text-violet-600" />
            <span>{fileName || 'Choose a JSON export (maximum 10 MB)'}</span>
          </label>
          <input id="importFile" className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void handleFile(event.target.files?.[0])} />
        </div>

        {source !== 'budget-app' && (
          <div>
            <label htmlFor="identityMap" className="block text-sm font-medium text-gray-700 mb-2">Identity mapping</label>
            <textarea id="identityMap" rows={5} value={identityMap} onChange={(event) => { setIdentityMap(event.target.value); resetPreview() }} className="input-field w-full font-mono text-sm" />
            <p className="mt-2 text-xs text-gray-500">Map source child/user IDs to existing Family Planner user IDs, for example {`{"source-id":"family-user-id"}`}.</p>
          </div>
        )}

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}

        <button type="button" disabled={loading || !fileData} onClick={() => void runImport(true)} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Validate dry run
        </button>
      </div>

      {result && (
        <div className="card space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Reconciliation preview</h2>
          <pre className="max-h-96 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">{JSON.stringify(result, null, 2)}</pre>
          <label className="flex items-start gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
            I reviewed the created, reused, and skipped counts and approve writing these records to this family.
          </label>
          <button type="button" disabled={loading || !confirmed} onClick={() => void runImport(false)} className="btn-primary disabled:opacity-50">
            Persist approved import
          </button>
        </div>
      )}
    </div>
  )
}
