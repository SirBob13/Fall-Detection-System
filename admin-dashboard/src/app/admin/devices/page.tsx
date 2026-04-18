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
  last_seen?: string | null;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ data: DeviceItem[] }>("/admin/devices?limit=100")
      .then((res) => setDevices(res.data))
      .catch((err) => setError(err.message));
  }, []);

  useRealtimeEvents(["devices"], (event) => {
    if (!event.payload) return;
    setDevices((prev) => {
      const payload = event.payload as DeviceItem;
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
                  <span className="text-slate-100 font-semibold">{device.device_id}</span> · User {device.user_id}
                </p>
                <span className={`text-xs ${
                  device.connection_state === "connected" ? "text-emerald-300" : "text-slate-500"
                }`}>
                  {device.connection_state === "connected" ? "Connected" : "Offline"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-400">Battery {device.battery_level ?? "-"} | Firmware {device.firmware_version || "-"}</p>
              <p className="mt-1 text-xs text-slate-500">Last seen: {device.last_seen || "-"}</p>
            </div>
          ))}
          {!devices.length && <p className="text-sm text-slate-400">No devices yet.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
