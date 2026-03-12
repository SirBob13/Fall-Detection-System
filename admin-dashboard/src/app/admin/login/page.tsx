"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_V1, setToken } from "../_lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Email and password required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_V1}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.access_token) {
        throw new Error(data?.error || data?.detail?.error || "Login failed");
      }
      setToken(data.access_token);
      router.replace("/admin/overview");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950/80 p-8 shadow-2xl shadow-cyan-500/10">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/70">Secure Access</p>
        <h1 className="font-display text-3xl mt-2">Admin Login</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in to access system alerts, device telemetry, and user reports.
        </p>

        <div className="mt-6 grid gap-4">
          <label className="text-sm text-slate-300">Email</label>
          <input
            className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-100 outline-none focus:border-cyan-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@email.com"
            type="email"
          />
          <label className="text-sm text-slate-300">Password</label>
          <input
            className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-100 outline-none focus:border-cyan-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
          />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="mt-6 w-full rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Login"}
        </button>
      </div>
    </div>
  );
}
