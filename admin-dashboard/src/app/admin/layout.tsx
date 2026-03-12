"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import RequireAuth from "./_components/RequireAuth";
import { clearToken } from "./_lib/api";

const NAV_ITEMS = [
  { href: "/admin/overview", label: "Overview" },
  { href: "/admin/alerts", label: "Alerts" },
  { href: "/admin/vitals", label: "Vitals" },
  { href: "/admin/devices", label: "Devices" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/docs", label: "API Docs" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";

  const handleLogout = () => {
    clearToken();
    router.replace("/admin/login");
  };

  if (isLogin) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-lg shadow-cyan-500/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/70">Fall Detection</p>
              <h1 className="font-display text-3xl">Admin Control Room</h1>
              <p className="text-sm text-slate-400">AI signals, device health, and incident tracking.</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-300 hover:text-cyan-200"
            >
              Logout
            </button>
          </div>
          <nav className="flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    active
                      ? "bg-cyan-500/15 text-cyan-100 border border-cyan-400/40"
                      : "border border-slate-800 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <RequireAuth>{children}</RequireAuth>
      </div>
    </div>
  );
}
