import { API_CONFIG } from '../utils/constants';

export type RealtimeEvent = {
  type: string;
  resource: string;
  action?: string;
  user_id?: number;
  timestamp?: number;
  payload?: any;
};

type Listener = (event: RealtimeEvent) => void;

class RealtimeService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<Listener>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private token: string | null = null;

  private buildWsUrl(token: string): string {
    const base = API_CONFIG.BASE_URL.replace(/\/api\/v1$/, '');
    const wsBase = base.replace(/^http/i, (match) => (match.toLowerCase() === 'https' ? 'wss' : 'ws'));
    return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
  }

  connect(token: string): void {
    if (!token) return;
    this.token = token;
    this.shouldReconnect = true;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
    }
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || !this.token) return;
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private openSocket(): void {
    if (!this.token) return;
    try {
      const url = this.buildWsUrl(this.token);
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          if (!data || !data.resource) return;
          this.emit(data.resource, data);
          this.emit('all', data);
        } catch {
          // ignore malformed
        }
      };

      this.socket.onerror = () => {
        // Let close handler retry
      };

      this.socket.onclose = () => {
        this.socket = null;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  subscribe(resource: string, handler: Listener): () => void {
    const key = resource || 'all';
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler);

    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  private emit(resource: string, event: RealtimeEvent): void {
    const set = this.listeners.get(resource);
    if (!set) return;
    set.forEach((handler) => handler(event));
  }
}

export const realtimeService = new RealtimeService();
