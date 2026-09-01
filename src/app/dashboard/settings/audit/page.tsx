"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AuditEntry = {
  id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  metadata: unknown;
  created_at: string;
};

export default function AuditHistoryPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit?limit=100")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Could not load audit history");
        setLogs(payload.logs);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load audit history",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Audit History</h1>
        <p className="text-gray-600 mt-1">
          Security and account changes for your family.
        </p>
      </div>

      {loading ? (
        <div className="card p-6 text-gray-600">Loading audit history…</div>
      ) : error ? (
        <div className="card p-6 text-red-700">{error}</div>
      ) : logs.length === 0 ? (
        <div className="card p-6 text-gray-600">No audited changes yet.</div>
      ) : (
        <ol className="card divide-y divide-gray-200">
          {logs.map((log) => (
            <li key={log.id} className="p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-medium text-gray-900">
                  {log.action.replaceAll(".", " ")}
                </p>
                <time
                  className="text-xs text-gray-500"
                  dateTime={log.created_at}
                >
                  {new Date(log.created_at).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {log.actor_name} · {log.resource_type}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
