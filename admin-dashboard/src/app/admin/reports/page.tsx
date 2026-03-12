"use client";

import { useEffect, useState } from "react";
import { apiFetch, API_V1, buildDateQuery, getToken } from "../_lib/api";

interface SeriesPoint {
  date: string;
  count: number;
}

interface ReportData {
  success: boolean;
  period: "daily" | "weekly" | "monthly";
  since: string;
  until: string;
  summary: {
    motions: number;
    vitals: number;
    alerts: number;
    predictions: number;
  };
  series: {
    motions: SeriesPoint[];
    vitals: SeriesPoint[];
    alerts: SeriesPoint[];
  };
}

const PERIODS: Array<ReportData["period"]> = ["daily", "weekly", "monthly"];

export default function ReportsPage() {
  const [period, setPeriod] = useState<ReportData["period"]>("weekly");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = buildDateQuery(start, end);
      const res = await apiFetch<ReportData>(`/admin/reports?period=${period}${query}`);
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const exportPdf = async () => {
    const token = getToken();
    const query = buildDateQuery(start, end);
    const res = await fetch(`${API_V1}/admin/reports/export?period=${period}${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      alert("PDF export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${period}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderSeries = (title: string, points: SeriesPoint[], color: string) => {
    const max = Math.max(1, ...points.map((p) => p.count));
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <h3 className="font-display text-lg">{title}</h3>
        <div className="mt-4 space-y-2 text-sm text-slate-300">
          {points.map((p) => (
            <div key={`${title}-${p.date}`} className="flex items-center gap-3">
              <span className="w-24 text-xs text-slate-400">{p.date}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-900">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${(p.count / max) * 100}%`, backgroundColor: color }}
                />
              </div>
              <span className="w-8 text-right text-xs text-slate-300">{p.count}</span>
            </div>
          ))}
          {!points.length && <p className="text-xs text-slate-500">No data.</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span>Period</span>
            <div className="flex gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded-full px-4 py-1.5 text-xs uppercase tracking-[0.2em] ${
                    period === p
                      ? "border border-cyan-400/60 text-cyan-100"
                      : "border border-slate-700 text-slate-400"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
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
          <button
            onClick={exportPdf}
            className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
          >
            Export PDF
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Motions", value: data?.summary?.motions ?? 0 },
          { title: "Vitals", value: data?.summary?.vitals ?? 0 },
          { title: "Alerts", value: data?.summary?.alerts ?? 0 },
          { title: "Predictions", value: data?.summary?.predictions ?? 0 },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">{card.title}</p>
            <h2 className="mt-3 font-display text-3xl">{card.value}</h2>
          </div>
        ))}
      </section>

      {data && (
        <section className="grid gap-4 lg:grid-cols-3">
          {renderSeries("Motions", data.series.motions, "rgba(34,211,238,0.8)")}
          {renderSeries("Vitals", data.series.vitals, "rgba(16,185,129,0.8)")}
          {renderSeries("Alerts", data.series.alerts, "rgba(248,113,113,0.8)")}
        </section>
      )}

      {loading && <p className="text-sm text-slate-400">Loading reports...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
