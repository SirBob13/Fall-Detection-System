"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../_lib/api";
import { useRealtimeEvents } from "../_lib/realtime";

interface DeviceItem {
  id: number;
  device_id: string;
  user_id: number;
  battery_level?: number | null;
  firmware_version?: string | null;
  is_connected: boolean;
  is_online?: boolean;
  connection_state?: "connected" | "disconnected" | "offline" | "archived";
  data_state?: "streaming" | "stale" | "no_data";
  device_status?: "active" | "warming_up" | "connected_no_data" | "disconnected" | "offline" | "archived";
  device_status_label?: string;
  latest_data_at?: string | null;
  last_seen?: string | null;
  ai_warmup?: boolean;
  ai_samples_collected?: number;
  ai_min_samples_for_alert?: number;
}

const statusTone = (status?: DeviceItem["device_status"]) => {
  if (status === "active") return "text-emerald-300";
  if (status === "warming_up") return "text-sky-300";
  if (status === "connected_no_data") return "text-amber-300";
  if (status === "disconnected") return "text-rose-300";
  return "text-slate-500";
};

const formatDeviceId = (deviceId?: string | null) => {
  if (!deviceId) return "-";
  if (deviceId.length <= 16) return deviceId;
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [resettingId, setResettingId] = useState<number | null>(null);

  const loadDevices = async () => {
    setError(null);
    try {
      const res = await apiFetch<{ data: DeviceItem[] }>("/admin/devices?limit=100");
      setDevices(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    }
  };

  useEffect(() => {
    void loadDevices();
  }, []);

  const resetDeviceData = async (device: DeviceItem) => {
    const confirmed = window.confirm(
      `Reset stored data for device "${device.device_id}"?\n\nThis will keep the device linked to the account, but remove its stored motions, vitals, predictions, alerts, and emergency logs.`
    );
    if (!confirmed) return;

    setResettingId(device.id);
    setError(null);
    try {
      await apiFetch(`/devices/${encodeURIComponent(device.device_id)}/reset?user_id=${device.user_id}`, {
        method: "POST",
      });
      await loadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset device data");
    } finally {
      setResettingId(null);
    }
  };

  const deleteDevice = async (device: DeviceItem) => {
    const confirmed = window.confirm(
      `Remove device "${device.device_id}" from the account?\n\nThis will unlink the device and remove its stored data, but it can be paired again later.`
    );
    if (!confirmed) return;

    setDeletingId(device.id);
    setError(null);
    try {
      await apiFetch(`/devices/${encodeURIComponent(device.device_id)}?user_id=${device.user_id}`, {
        method: "DELETE",
      });
      setDevices((prev) => prev.filter((item) => item.id !== device.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete device");
    } finally {
      setDeletingId(null);
    }
  };

  useRealtimeEvents(["devices"], (event) => {
    if (!event.payload) return;
    setDevices((prev) => {
      const payload = event.payload as DeviceItem;
      if (event.action === "deleted") {
        return prev.filter((item) => item.id !== payload.id);
      }
      const exists = prev.find((item) => item.id === payload.id);
      const next = exists
        ? prev.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
        : [payload, ...prev];
      return next.slice(0, 100);
    });
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <h2 className="font-display text-xl">Devices</h2>
        <div className="mt-4 grid gap-3">
          {devices.map((device) => (
            <div key={device.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-300">
                  <span className="text-slate-100 font-semibold font-mono">{formatDeviceId(device.device_id)}</span> · User {device.user_id}
                </p>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${statusTone(device.device_status)}`}>
                    {device.device_status_label || "Offline"}
                  </span>
                  <button
                    type="button"
                    onClick={() => resetDeviceData(device)}
                    disabled={resettingId === device.id || deletingId === device.id}
                    className="rounded-full border border-amber-500/40 px-3 py-1 text-xs text-amber-200 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resettingId === device.id ? "Resetting..." : "Reset data"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDevice(device)}
                    disabled={deletingId === device.id || resettingId === device.id}
                    className="rounded-full border border-rose-500/40 px-3 py-1 text-xs text-rose-200 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === device.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-400">Battery {device.battery_level ?? "-"} | Firmware {device.firmware_version || "-"}</p>
              <p className="mt-1 text-xs text-cyan-200">Full device ID: <span className="font-mono">{device.device_id}</span></p>
              <p className="mt-1 text-xs text-slate-500">
                Last seen: {device.last_seen || "-"}
                {device.latest_data_at ? ` · Data: ${device.latest_data_at}` : ""}
              </p>
              {device.ai_warmup ? (
                <p className="mt-1 text-xs text-sky-300">
                  AI warming up: {device.ai_samples_collected ?? 0}/{device.ai_min_samples_for_alert ?? 0} readings collected
                </p>
              ) : null}
            </div>
          ))}
          {!devices.length && <p className="text-sm text-slate-400">No devices yet.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
