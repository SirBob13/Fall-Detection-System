"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../_lib/api";
import { adminRealtime } from "../_lib/realtime";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/admin/login");
      return;
    }
    adminRealtime.connect();
    setReady(true);
    return () => {
      adminRealtime.disconnect();
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        Checking session...
      </div>
    );
  }

  return <>{children}</>;
}
