export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://141.147.32.182:8000";
export const API_V1 = `${API_BASE}/api/v1`;

const TOKEN_KEY = "fd_admin_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_V1}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data?.detail && (data.detail.error || data.detail)) || data?.error || res.statusText;
    throw new Error(message);
  }

  return res.json();
}

export function buildDateQuery(start?: string, end?: string) {
  const parts: string[] = [];
  if (start) parts.push(`start=${encodeURIComponent(start)}`);
  if (end) parts.push(`end=${encodeURIComponent(end)}`);
  return parts.length ? `&${parts.join("&")}` : "";
}
