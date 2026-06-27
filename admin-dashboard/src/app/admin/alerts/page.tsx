"use client";

import { useEffect, useState } from "react";
import { apiFetch, buildDateQuery } from "../_lib/api";
import { formatApiDateTime } from "../_lib/datetime";
import { useRealtimeEvents } from "../_lib/realtime";

interface AlertItem {
  id: number;
  user_id: number;
  device_id?: string | null;
  type: string;
  severity: string;
  status: string;
  message: string;
  timestamp?: string | null;
}

const formatDeviceId = (deviceId?: string | null) => {
  if (!deviceId) return "-";
  if (deviceId.length <= 16) return deviceId;
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const query = buildDateQuery(start, end);
    apiFetch<{ data: AlertItem[] }>(`/admin/alerts?limit=50${query}`)
      .then((res) => setAlerts(res.data))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  useRealtimeEvents(["alerts"], (event) => {
    if (!event.payload) return;
    setAlerts((prev) => {
      const payload = event.payload as AlertItem;
      const exists = prev.find((item) => item.id === payload.id);
      const next = exists
        ? prev.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
        : [payload, ...prev];
      return next.slice(0, 50);
    });
  });

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
            className="rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-100 hover:border-cyan-300"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <h2 className="font-display text-xl">Alerts</h2>
        <div className="mt-4 grid gap-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-300">
                  <span className="text-slate-100 font-semibold">{alert.type}</span> · {alert.severity} · {alert.status}
                </p>
                <span className="text-xs text-slate-500">User {alert.user_id}</span>
              </div>
              <p className="mt-2 text-xs text-cyan-200">Source device: <span className="font-mono">{formatDeviceId(alert.device_id)}</span></p>
              <p className="mt-2 text-sm text-slate-400">{alert.message}</p>
              <p className="mt-2 text-xs text-slate-500">{formatApiDateTime(alert.timestamp)}</p>
            </div>
          ))}
          {!alerts.length && <p className="text-sm text-slate-400">No alerts yet.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
