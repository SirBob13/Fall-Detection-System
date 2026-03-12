"use client";

import { useEffect, useState } from "react";
import { apiFetch, buildDateQuery } from "../_lib/api";

interface VitalItem {
  id: number;
  user_id: number;
  heart_rate?: number;
  oxygen_saturation?: number;
  body_temperature?: number;
  respiration_rate?: number;
  is_abnormal: boolean;
  abnormality_type?: string | null;
  timestamp?: string | null;
}

export default function VitalsPage() {
  const [vitals, setVitals] = useState<VitalItem[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const query = buildDateQuery(start, end);
    apiFetch<{ data: VitalItem[] }>(`/admin/vitals?limit=50${query}`)
      .then((res) => setVitals(res.data))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span>Start</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span>End</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
            />
          </div>
          <button
            onClick={load}
            className="rounded-full border border-emerald-400/40 px-4 py-2 text-sm text-emerald-200 hover:border-emerald-300"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <h2 className="font-display text-xl">Vitals</h2>
        <div className="mt-4 grid gap-3">
          {vitals.map((vital) => (
            <div key={vital.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-300">
                  <span className="text-slate-100 font-semibold">User {vital.user_id}</span>
                  {vital.is_abnormal && <span className="ml-2 text-red-400">Abnormal</span>}
                </p>
                <span className="text-xs text-slate-500">{vital.timestamp || "-"}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                HR {vital.heart_rate ?? "-"} | SpO2 {vital.oxygen_saturation ?? "-"} | Temp {vital.body_temperature ?? "-"}
              </p>
              <p className="mt-1 text-xs text-slate-500">Resp {vital.respiration_rate ?? "-"} | {vital.abnormality_type || "Normal"}</p>
            </div>
          ))}
          {!vitals.length && <p className="text-sm text-slate-400">No vitals yet.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
