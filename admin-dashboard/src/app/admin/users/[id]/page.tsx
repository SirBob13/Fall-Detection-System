"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, API_V1, buildDateQuery, getToken } from "../../_lib/api";
import { useRealtimeEvents } from "../../_lib/realtime";

interface UserDevice {
  id: number;
  device_id: string;
  battery_level?: number | null;
  firmware_version?: string | null;
  is_connected: boolean;
  last_seen?: string | null;
}

interface UserDetail {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  age?: number | null;
  gender?: string | null;
  weight?: number | null;
  height?: number | null;
  medical_conditions?: string | null;
  emergency_contact?: string | null;
  devices: UserDevice[];
  stats: {
    alerts: number;
    vitals: number;
    motions: number;
  };
}

interface AlertItem {
  id: number;
  prediction_id?: number | null;
  type: string;
  severity: string;
  status: string;
  message?: string | null;
  timestamp?: string | null;
}

interface VitalItem {
  id: number;
  heart_rate?: number | null;
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  oxygen_saturation?: number | null;
  body_temperature?: number | null;
  respiration_rate?: number | null;
  is_abnormal: boolean;
  abnormality_type?: string | null;
  timestamp?: string | null;
}

interface MotionItem {
  id: number;
  device_id?: string | null;
  acc_x?: number | null;
  acc_y?: number | null;
  acc_z?: number | null;
  acc_mag?: number | null;
  gyro_x?: number | null;
  gyro_y?: number | null;
  gyro_z?: number | null;
  gyro_mag?: number | null;
  temperature?: number | null;
  is_fall_suspected: boolean;
  timestamp?: string | null;
}

interface PredictionItem {
  id: number;
  motion_data_id?: number | null;
  fall_now_probability?: number | null;
  fall_soon_probability?: number | null;
  fall_now_prediction: boolean;
  fall_soon_prediction: boolean;
  vital_check_performed: boolean;
  vital_check_result?: string | null;
  final_verdict?: string | null;
  confidence_score?: number | null;
  timestamp?: string | null;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = Number(params?.id);

  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [vitals, setVitals] = useState<VitalItem[]>([]);
  const [motions, setMotions] = useState<MotionItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    if (!userId || Number.isNaN(userId)) {
      setError("Invalid user id");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = buildDateQuery(start, end);
      const [detailRes, alertsRes, vitalsRes, motionsRes, predsRes] = await Promise.all([
        apiFetch<{ data: UserDetail }>(`/admin/users/${userId}`),
        apiFetch<{ data: AlertItem[] }>(`/admin/users/${userId}/alerts?limit=50${query}`),
        apiFetch<{ data: VitalItem[] }>(`/admin/users/${userId}/vitals?limit=50${query}`),
        apiFetch<{ data: MotionItem[] }>(`/admin/users/${userId}/motions?limit=50${query}`),
        apiFetch<{ data: PredictionItem[] }>(`/admin/users/${userId}/predictions?limit=50${query}`),
      ]);
      if (!detailRes?.data) {
        throw new Error("User detail not found");
      }
      const safeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
      setDetail(detailRes.data);
      setAlerts(safeArray<AlertItem>(alertsRes?.data));
      setVitals(safeArray<VitalItem>(vitalsRes?.data));
      setMotions(safeArray<MotionItem>(motionsRes?.data));
      setPredictions(safeArray<PredictionItem>(predsRes?.data));
    } catch (err: any) {
      setError(err.message || "Failed to load user details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [userId]);

  const withinRange = (timestamp?: string | null) => {
    if (!timestamp) return true;
    if (!start && !end) return true;
    const ts = new Date(timestamp).getTime();
    if (Number.isNaN(ts)) return true;
    if (start) {
      const startTs = new Date(start).getTime();
      if (!Number.isNaN(startTs) && ts < startTs) return false;
    }
    if (end) {
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      const endTs = endDate.getTime();
      if (!Number.isNaN(endTs) && ts > endTs) return false;
    }
    return true;
  };

  const upsertById = <T extends { id: number }>(list: T[], payload: T, limit = 50) => {
    const exists = list.find((item) => item.id === payload.id);
    const next = exists
      ? list.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
      : [payload, ...list];
    return next.slice(0, limit);
  };

  const upsertWithRange = <T extends { id: number; timestamp?: string | null }>(list: T[], payload: T) => {
    const exists = list.find((item) => item.id === payload.id);
    if (!exists && !withinRange(payload.timestamp ?? null)) return list;
    return upsertById(list, payload, 50);
  };

  useRealtimeEvents(["users", "alerts", "vitals", "predictions", "devices", "motions"], (event) => {
    if (!event.payload) return;

    if (event.resource === "users" && event.payload.id === userId) {
      setDetail((prev) => (prev ? { ...prev, ...event.payload } : prev));
      return;
    }

    if (event.resource === "devices" && event.payload.user_id === userId) {
      setDetail((prev) => {
        if (!prev) return prev;
        const devices = upsertById(prev.devices || [], event.payload as UserDevice, 50);
        return { ...prev, devices };
      });
      return;
    }

    if (event.resource === "alerts" && event.payload.user_id === userId) {
      setAlerts((prev) => upsertWithRange(prev, event.payload as AlertItem));
      if (event.action === "created") {
        setDetail((prev) =>
          prev ? { ...prev, stats: { ...prev.stats, alerts: prev.stats.alerts + 1 } } : prev
        );
      }
      return;
    }

    if (event.resource === "vitals" && event.payload.user_id === userId) {
      setVitals((prev) => upsertWithRange(prev, event.payload as VitalItem));
      if (event.action === "created") {
        setDetail((prev) =>
          prev ? { ...prev, stats: { ...prev.stats, vitals: prev.stats.vitals + 1 } } : prev
        );
      }
      return;
    }

    if (event.resource === "motions" && event.payload.user_id === userId) {
      setMotions((prev) => upsertWithRange(prev, event.payload as MotionItem));
      if (event.action === "created") {
        setDetail((prev) =>
          prev ? { ...prev, stats: { ...prev.stats, motions: prev.stats.motions + 1 } } : prev
        );
      }
      return;
    }

    if (event.resource === "predictions" && event.payload.user_id === userId) {
      setPredictions((prev) => upsertWithRange(prev, event.payload as PredictionItem));
    }
  });

  const toggleStatus = async () => {
    if (!detail) return;
    try {
      const next = !detail.is_active;
      await apiFetch(`/admin/users/${detail.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ is_active: next }),
      });
      setDetail({ ...detail, is_active: next });
    } catch (err: any) {
      setError(err.message || "Failed to update status");
    }
  };

  const deleteUser = async () => {
    if (!detail) return;
    if (!confirm("Delete this user? This cannot be undone.")) return;
    try {
      await apiFetch(`/admin/users/${detail.id}`, { method: "DELETE" });
      router.push("/admin/users");
    } catch (err: any) {
      setError(err.message || "Failed to delete user");
    }
  };

  const exportPdf = async () => {
    if (!detail) return;
    const token = getToken();
    const res = await fetch(`${API_V1}/admin/users/${detail.id}/report.pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Failed to export PDF");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `user_${detail.id}_report.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Link href="/admin/users" className="text-cyan-300 hover:text-cyan-200">← Back to Users</Link>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">User Profile</p>
            <h2 className="mt-2 font-display text-2xl text-slate-100">{detail?.name || "User"}</h2>
            <p className="text-sm text-slate-400">{detail?.email || ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={toggleStatus}
              className={`rounded-full px-4 py-2 text-sm ${detail?.is_active ? "border border-amber-400/50 text-amber-200" : "border border-emerald-400/50 text-emerald-200"}`}
            >
              {detail?.is_active ? "Deactivate" : "Activate"}
            </button>
            <button
              onClick={exportPdf}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
            >
              Export PDF
            </button>
            <button
              onClick={deleteUser}
              className="rounded-full border border-red-400/40 px-4 py-2 text-sm text-red-200 hover:border-red-300"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "Alerts", value: detail?.stats?.alerts ?? 0 },
            { title: "Vitals", value: detail?.stats?.vitals ?? 0 },
            { title: "Motions", value: detail?.stats?.motions ?? 0 },
            { title: "Devices", value: detail?.devices?.length ?? 0 },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">{card.title}</p>
              <h3 className="mt-2 text-2xl font-display text-slate-100">{card.value}</h3>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 text-sm text-slate-400 md:grid-cols-2">
          <div>
            <p>Created: <span className="text-slate-300">{detail?.created_at || "-"}</span></p>
            <p>Updated: <span className="text-slate-300">{detail?.updated_at || "-"}</span></p>
            <p>Emergency Contact: <span className="text-slate-300">{detail?.emergency_contact || "-"}</span></p>
          </div>
          <div>
            <p>Age: <span className="text-slate-300">{detail?.age ?? "-"}</span></p>
            <p>Gender: <span className="text-slate-300">{detail?.gender || "-"}</span></p>
            <p>Weight/Height: <span className="text-slate-300">{detail?.weight ?? "-"} / {detail?.height ?? "-"}</span></p>
          </div>
        </div>
      </div>

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
            onClick={loadAll}
            className="rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-100 hover:border-cyan-300"
          >
            Apply
          </button>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Devices</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {detail?.devices?.map((device) => (
              <div key={device.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">{device.device_id}</span>
                  <span className={`text-xs ${device.is_connected ? "text-emerald-300" : "text-slate-500"}`}>
                    {device.is_connected ? "Connected" : "Offline"}
                  </span>
                </div>
                <p className="text-xs text-slate-500">Battery {device.battery_level ?? "-"} | Firmware {device.firmware_version || "-"}</p>
                <p className="text-xs text-slate-500">Last seen: {device.last_seen || "-"}</p>
              </div>
            ))}
            {!detail?.devices?.length && <p className="text-sm text-slate-400">No devices linked.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Alerts</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-xs text-slate-500">{alert.timestamp || "-"}</p>
                <p className="text-sm text-slate-200">{alert.type} · {alert.severity} · {alert.status}</p>
                <p className="text-xs text-slate-400">{alert.message || "-"}</p>
              </div>
            ))}
            {!alerts.length && <p className="text-sm text-slate-400">No alerts found.</p>}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Vitals</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {vitals.map((vital) => (
              <div key={vital.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-xs text-slate-500">{vital.timestamp || "-"}</p>
                <p className="text-sm text-slate-200">
                  HR {vital.heart_rate ?? "-"} | SpO2 {vital.oxygen_saturation ?? "-"} | Temp {vital.body_temperature ?? "-"}
                </p>
                <p className="text-xs text-slate-400">Resp {vital.respiration_rate ?? "-"} | {vital.abnormality_type || "Normal"}</p>
              </div>
            ))}
            {!vitals.length && <p className="text-sm text-slate-400">No vitals found.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Motions</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {motions.map((motion) => (
              <div key={motion.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-xs text-slate-500">{motion.timestamp || "-"}</p>
                <p className="text-sm text-slate-200">Device {motion.device_id || "-"} | Fall suspected: {motion.is_fall_suspected ? "Yes" : "No"}</p>
                <p className="text-xs text-slate-400">acc({motion.acc_x ?? "-"}, {motion.acc_y ?? "-"}, {motion.acc_z ?? "-"}) gyro({motion.gyro_x ?? "-"}, {motion.gyro_y ?? "-"}, {motion.gyro_z ?? "-"})</p>
              </div>
            ))}
            {!motions.length && <p className="text-sm text-slate-400">No motions found.</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <h3 className="font-display text-lg">Predictions</h3>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {predictions.map((pred) => (
            <div key={pred.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-xs text-slate-500">{pred.timestamp || "-"}</p>
              <p className="text-sm text-slate-200">Verdict: {pred.final_verdict || "-"} | Confidence {pred.confidence_score ?? "-"}</p>
              <p className="text-xs text-slate-400">Fall now: {pred.fall_now_prediction ? "Yes" : "No"} ({pred.fall_now_probability ?? "-"})</p>
              <p className="text-xs text-slate-400">Fall soon: {pred.fall_soon_prediction ? "Yes" : "No"} ({pred.fall_soon_probability ?? "-"})</p>
            </div>
          ))}
          {!predictions.length && <p className="text-sm text-slate-400">No predictions found.</p>}
        </div>
      </section>

      {loading && <p className="text-sm text-slate-400">Loading user data...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
