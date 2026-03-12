"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, API_V1 } from "../../_lib/api";

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
  devices: Array<{
    id: number;
    device_id: string;
    battery_level?: number | null;
    firmware_version?: string | null;
    is_connected: boolean;
    last_seen?: string | null;
  }>;
  stats: {
    alerts: number;
    vitals: number;
    motions: number;
  };
}

interface AlertItem {
  id: number;
  type: string;
  severity: string;
  status: string;
  message: string;
  timestamp?: string | null;
}

interface VitalItem {
  id: number;
  heart_rate?: number;
  oxygen_saturation?: number;
  body_temperature?: number;
  respiration_rate?: number;
  is_abnormal: boolean;
  abnormality_type?: string | null;
  timestamp?: string | null;
}

interface MotionItem {
  id: number;
  device_id: string;
  acc_mag?: number;
  gyro_mag?: number;
  temperature?: number;
  is_fall_suspected: boolean;
  timestamp?: string | null;
}

interface PredictionItem {
  id: number;
  fall_now_probability: number;
  fall_soon_probability: number;
  fall_now_prediction: boolean;
  fall_soon_prediction: boolean;
  final_verdict?: boolean | null;
  confidence_score?: number | null;
  timestamp?: string | null;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id as string;

  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [vitals, setVitals] = useState<VitalItem[]>([]);
  const [motions, setMotions] = useState<MotionItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [detailRes, alertRes, vitalRes, motionRes, predRes] = await Promise.all([
        apiFetch<{ data: UserDetail }>(`/admin/users/${userId}`),
        apiFetch<{ data: AlertItem[] }>(`/admin/users/${userId}/alerts?limit=10`),
        apiFetch<{ data: VitalItem[] }>(`/admin/users/${userId}/vitals?limit=10`),
        apiFetch<{ data: MotionItem[] }>(`/admin/users/${userId}/motions?limit=10`),
        apiFetch<{ data: PredictionItem[] }>(`/admin/users/${userId}/predictions?limit=10`),
      ]);

      setDetail(detailRes.data);
      setAlerts(alertRes.data);
      setVitals(vitalRes.data);
      setMotions(motionRes.data);
      setPredictions(predRes.data);
    } catch (err: any) {
      setError(err.message || "Failed to load user data");
    }
  };

  useEffect(() => {
    if (userId) {
      loadAll();
    }
  }, [userId]);

  const toggleStatus = async () => {
    if (!detail) return;
    await apiFetch(`/admin/users/${userId}/status`, {
      method: "PUT",
      body: JSON.stringify({ is_active: !detail.is_active }),
    });
    await loadAll();
  };

  const deleteUser = async () => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
    router.replace("/admin/users");
  };

  const downloadPdf = async () => {
    const token = localStorage.getItem("fd_admin_token");
    const res = await fetch(`${API_V1}/admin/users/${userId}/report.pdf`, {
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
    a.download = `user_${userId}_report.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!detail) {
    return <div className="text-slate-400">Loading user details...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">User</p>
            <h2 className="font-display text-2xl">{detail.name}</h2>
            <p className="text-sm text-slate-400">{detail.email}</p>
            <p className="text-xs text-slate-500">Created: {detail.created_at || "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={toggleStatus}
              className="rounded-full border border-emerald-400/40 px-4 py-2 text-sm text-emerald-200"
            >
              {detail.is_active ? "Deactivate" : "Activate"}
            </button>
            <button
              onClick={downloadPdf}
              className="rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-200"
            >
              Download PDF
            </button>
            <button
              onClick={deleteUser}
              className="rounded-full border border-red-400/40 px-4 py-2 text-sm text-red-300"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <p>Age: {detail.age ?? "-"}</p>
            <p>Gender: {detail.gender ?? "-"}</p>
            <p>Weight: {detail.weight ?? "-"}</p>
            <p>Height: {detail.height ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <p>Medical conditions: {detail.medical_conditions || "-"}</p>
            <p>Emergency contact: {detail.emergency_contact || "-"}</p>
            <p>Alerts: {detail.stats.alerts}</p>
            <p>Vitals: {detail.stats.vitals} | Motions: {detail.stats.motions}</p>
          </div>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Devices</h3>
          <div className="mt-3 grid gap-3">
            {detail.devices.map((device) => (
              <div key={device.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <p className="font-semibold text-slate-100">{device.device_id}</p>
                <p>Battery: {device.battery_level ?? "-"}</p>
                <p>Status: {device.is_connected ? "Connected" : "Offline"}</p>
                <p className="text-xs text-slate-500">Last seen: {device.last_seen || "-"}</p>
              </div>
            ))}
            {!detail.devices.length && <p className="text-sm text-slate-400">No devices linked.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Recent Alerts</h3>
          <div className="mt-3 grid gap-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <p className="font-semibold text-slate-100">{alert.type} · {alert.severity}</p>
                <p className="text-xs text-slate-500">{alert.timestamp || "-"}</p>
                <p className="text-sm text-slate-400">{alert.message}</p>
              </div>
            ))}
            {!alerts.length && <p className="text-sm text-slate-400">No alerts.</p>}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Recent Vitals</h3>
          <div className="mt-3 grid gap-3">
            {vitals.map((vital) => (
              <div key={vital.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <p>HR {vital.heart_rate ?? "-"} | SpO2 {vital.oxygen_saturation ?? "-"} | Temp {vital.body_temperature ?? "-"}</p>
                <p className="text-xs text-slate-500">{vital.timestamp || "-"}</p>
              </div>
            ))}
            {!vitals.length && <p className="text-sm text-slate-400">No vitals.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h3 className="font-display text-lg">Recent Motions</h3>
          <div className="mt-3 grid gap-3">
            {motions.map((motion) => (
              <div key={motion.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <p>Acc {motion.acc_mag ?? "-"} | Gyro {motion.gyro_mag ?? "-"}</p>
                <p className="text-xs text-slate-500">{motion.timestamp || "-"}</p>
              </div>
            ))}
            {!motions.length && <p className="text-sm text-slate-400">No motions.</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <h3 className="font-display text-lg">Recent Predictions</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {predictions.map((pred) => (
            <div key={pred.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
              <p>Fall Now: {pred.fall_now_probability.toFixed(2)} | Fall Soon: {pred.fall_soon_probability.toFixed(2)}</p>
              <p className="text-xs text-slate-500">Confidence: {pred.confidence_score ?? "-"}</p>
              <p className="text-xs text-slate-500">{pred.timestamp || "-"}</p>
            </div>
          ))}
          {!predictions.length && <p className="text-sm text-slate-400">No predictions.</p>}
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
