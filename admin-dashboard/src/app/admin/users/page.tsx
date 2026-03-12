"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, API_V1, getToken } from "../_lib/api";

interface UserItem {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  devices: number;
  last_seen?: string | null;
  created_at?: string | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = (query = "") => {
    const q = query ? `&search=${encodeURIComponent(query)}` : "";
    apiFetch<{ data: UserItem[] }>(`/admin/users?limit=50${q}`)
      .then((res) => setUsers(res.data))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-xl">Users</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              placeholder="Search name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              onClick={() => load(search)}
              className="rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-100 hover:border-cyan-300"
            >
              Search
            </button>
            <button
              onClick={async () => {
                const token = getToken();
                const res = await fetch(`${API_V1}/admin/users/export`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (!res.ok) {
                  alert("Export failed");
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "users.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {users.map((user) => (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-cyan-400/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{user.name}</p>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </div>
                <span className={`text-xs ${user.is_active ? "text-emerald-300" : "text-red-400"}`}>
                  {user.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Devices: {user.devices} · Last seen: {user.last_seen || "-"}
              </div>
            </Link>
          ))}
          {!users.length && <p className="text-sm text-slate-400">No users found.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
