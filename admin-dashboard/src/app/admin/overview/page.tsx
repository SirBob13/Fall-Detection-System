"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../_lib/api";
import { formatApiDateTime } from "../_lib/datetime";
import { useRealtimeEvents, useRealtimeRefresh } from "../_lib/realtime";

interface OverviewData {
  users: { total: number; active: number; login: number; logout: number };
  devices: { total: number; connected: number; offline: number };
  alerts: { total: number; active: number };
  motions: number;
  vitals: number;
  predictions: number;
  last_activity: { motion?: string | null; vital?: string | null; alert?: string | null };
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    apiFetch<{ data: OverviewData }>("/admin/overview")
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useRealtimeRefresh(["alerts", "vitals", "predictions", "devices", "motions", "users"], loadOverview, 800);

  useRealtimeEvents(["alerts", "vitals", "predictions", "devices", "motions"], (event) => {
    const payload = event.payload;
    if (!payload) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (event.resource === "alerts" && event.action === "created") {
        next.alerts = {
          ...prev.alerts,
          total: prev.alerts.total + 1,
          active:
            payload.status === "active" || payload.status === "pending"
              ? prev.alerts.active + 1
              : prev.alerts.active,
        };
        next.last_activity = {
          ...prev.last_activity,
          alert: payload.timestamp || prev.last_activity.alert,
        };
      }
      if (event.resource === "vitals" && event.action === "created") {
        next.vitals = prev.vitals + 1;
        next.last_activity = {
          ...prev.last_activity,
          vital: payload.timestamp || prev.last_activity.vital,
        };
      }
      if (event.resource === "predictions" && event.action === "created") {
        next.predictions = prev.predictions + 1;
        next.last_activity = {
          ...prev.last_activity,
          motion: payload.timestamp || prev.last_activity.motion,
        };
      }
      if (event.resource === "motions" && event.action === "created") {
        next.motions = prev.motions + 1;
        next.last_activity = {
          ...prev.last_activity,
          motion: payload.timestamp || prev.last_activity.motion,
        };
      }
      if (event.resource === "devices" && payload.connection_state !== undefined) {
        next.devices = { ...prev.devices };
      }
      if (event.resource === "users") {
        next.users = {
          total: prev.users.total,
          active: prev.users.active,
          login: prev.users.login,
          logout: prev.users.logout,
        };
      }
      return next;
    });
  });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Users", value: data?.users?.total ?? "-", sub: `Active: ${data?.users?.active ?? "-"} · Login: ${data?.users?.login ?? "-"}` },
          { title: "Devices", value: data?.devices?.total ?? "-", sub: `Connected: ${data?.devices?.connected ?? "-"} · Offline: ${data?.devices?.offline ?? "-"}` },
          { title: "Alerts", value: data?.alerts?.total ?? "-", sub: `Active: ${data?.alerts?.active ?? "-"}` },
          { title: "Stored Signals", value: `${data?.motions ?? 0} motion samples`, sub: `${data?.vitals ?? 0} vital snapshots stored` },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg shadow-cyan-500/5">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">{card.title}</p>
            <h2 className="mt-3 font-display text-3xl">{card.value}</h2>
            <p className="mt-2 text-sm text-slate-400">{card.sub}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
          <h3 className="font-display text-xl">Latest Activity</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-300">
            <p>Last motion: <span className="text-slate-400">{formatApiDateTime(data?.last_activity?.motion)}</span></p>
            <p>Last vital: <span className="text-slate-400">{formatApiDateTime(data?.last_activity?.vital)}</span></p>
            <p>Last alert: <span className="text-slate-400">{formatApiDateTime(data?.last_activity?.alert)}</span></p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
          <h3 className="font-display text-xl">Stored Signals Volume</h3>
          <p className="mt-2 text-sm text-slate-400">
            Stored database records, not live sensor readings per second.
          </p>
          <div className="mt-4 grid gap-3 text-sm text-slate-300">
            <div className="flex items-center justify-between">
              <span>Motion samples</span>
              <span className="text-cyan-200">{data?.motions ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Vital snapshots</span>
              <span className="text-emerald-200">{data?.vitals ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Predictions</span>
              <span className="text-slate-200">{data?.predictions ?? 0}</span>
            </div>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
