import { API_BASE, getToken } from "./api";

export type RealtimeEvent = {
  type: string;
  resource: string;
  action?: string;
  user_id?: number;
  timestamp?: number;
  payload?: Record<string, any> | null;
};

type Listener = (event: RealtimeEvent) => void;

class AdminRealtimeService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<Listener>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;

  private buildWsUrl(token: string) {
    const wsBase = API_BASE.replace(/^http/i, (match) => (match.toLowerCase() === "https" ? "wss" : "ws"));
    return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
  }

  connect() {
    const token = getToken();
    if (!token) return;
    this.shouldReconnect = true;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.openSocket(token);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
    }
    this.socket = null;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    const token = getToken();
    if (!token) return;
    this.stopHeartbeat();
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openSocket(token), delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        this.socket.send("ping");
      } catch {
        // Let onclose handle reconnect.
      }
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private openSocket(token: string) {
    try {
      const url = this.buildWsUrl(token);
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          if (!data || !data.resource) return;
          this.emit(data.resource, data);
          this.emit("all", data);
        } catch {
          // ignore
        }
      };

      this.socket.onclose = () => {
        this.stopHeartbeat();
        this.socket = null;
        this.scheduleReconnect();
      };

      this.socket.onerror = () => {
        // handled by onclose
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  subscribe(resource: string, handler: Listener) {
    const key = resource || "all";
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler);
    this.connect();

    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(handler);
        if (!set.size) this.listeners.delete(key);
      }
    };
  }

  private emit(resource: string, event: RealtimeEvent) {
    const set = this.listeners.get(resource);
    if (!set) return;
    set.forEach((handler) => handler(event));
  }
}

export const adminRealtime = new AdminRealtimeService();

import { useEffect, useMemo, useRef } from "react";

export function useRealtimeRefresh(resources: string[], onRefresh: () => void, delayMs = 600) {
  const refreshRef = useRef(onRefresh);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resourceKey = useMemo(() => resources.join("|"), [resources]);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const schedule = () => {
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        refreshRef.current();
      }, delayMs);
    };

    const unique = Array.from(new Set(["all", ...resources]));
    const unsubs = unique.map((resource) => adminRealtime.subscribe(resource, schedule));

    return () => {
      unsubs.forEach((unsub) => unsub());
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [delayMs, resourceKey, resources]);
}

export function useRealtimeEvents(
  resources: string[],
  handler: (event: RealtimeEvent) => void
) {
  const handlerRef = useRef(handler);
  const resourceKey = useMemo(() => resources.join("|"), [resources]);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = (event: RealtimeEvent) => handlerRef.current(event);
    const unique = Array.from(new Set(resources.length ? resources : ["all"]));
    const unsubs = unique.map((resource) => adminRealtime.subscribe(resource, listener));

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [resourceKey, resources]);
}
