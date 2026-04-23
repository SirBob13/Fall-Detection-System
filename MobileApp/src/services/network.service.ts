import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { API_CONFIG } from '../config/app.config';

export interface NetworkStatus {
  isConnected: boolean;
  type: string;
  isInternetReachable: boolean;
  details: any;
}

export interface NetworkConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  checkInterval: number;
}

export class NetworkService {
  private static instance: NetworkService;
  private listeners: Array<(status: NetworkStatus) => void> = [];
  private status: NetworkStatus = {
    isConnected: false,
    type: 'unknown',
    isInternetReachable: false,
    details: null,
  };
  private config: NetworkConfig = {
    maxRetries: 3,
    retryDelay: 2000,
    timeout: 10000,
    checkInterval: 30000,
  };
  private retryCount = 0;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  static getInstance(): NetworkService {
    if (!NetworkService.instance) {
      NetworkService.instance = new NetworkService();
    }
    return NetworkService.instance;
  }

  async initialize(): Promise<NetworkStatus> {
    try {
      const state = await NetInfo.fetch();
      await this.updateStatus(state);
      this.setupListeners();
      this.startPeriodicCheck();
      return this.status;
    } catch (error) {
      console.error('Network initialization error:', error);
      return this.status;
    }
  }

  private async probeBackendReachability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Math.min(this.config.timeout, 3500));

      const response = await fetch(`${API_CONFIG.BASE_URL}/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError' || String(error?.message || '').includes('Abort');
      if (!isAbort) {
        console.warn('⚠️ [Network] Backend reachability probe failed:', error?.message || error);
      }
      return false;
    }
  }

  private async resolveInternetReachability(state: NetInfoState): Promise<boolean> {
    const isConnected = state.isConnected ?? false;
    if (!isConnected) {
      return false;
    }

    if (state.isInternetReachable === true) {
      return true;
    }

    return await this.probeBackendReachability();
  }

  private async updateStatus(state: NetInfoState): Promise<void> {
    const newStatus: NetworkStatus = {
      isConnected: state.isConnected ?? false,
      type: state.type || 'unknown',
      isInternetReachable: await this.resolveInternetReachability(state),
      details: state.details,
    };

    const changed = JSON.stringify(this.status) !== JSON.stringify(newStatus);
    this.status = newStatus;

    if (changed) {
      this.notifyListeners();
    }
  }

  private setupListeners(): void {
    NetInfo.addEventListener(state => {
      void this.updateStatus(state);
    });
  }

  private startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        const state = await NetInfo.fetch();
        await this.updateStatus(state);
      } catch (error) {
        console.error('Periodic network check error:', error);
      }
    }, this.config.checkInterval);
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      await this.updateStatus(state);
      return this.status.isConnected && this.status.isInternetReachable;
    } catch (error) {
      console.error('Connectivity check error:', error);
      return false;
    }
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    customConfig?: Partial<NetworkConfig>
  ): Promise<T> {
    const config = { ...this.config, ...customConfig };
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        // Check connectivity before each attempt
        const isConnected = await this.checkConnectivity();
        if (!isConnected) {
          throw new Error('No internet connection');
        }

        const result = await this.withTimeout(operation(), config.timeout);
        this.retryCount = 0;
        return result;
      } catch (error: any) {
        lastError = error;
        console.warn(`Attempt ${attempt} failed:`, error.message);

        if (attempt < config.maxRetries) {
          await this.delay(config.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    this.retryCount++;
    throw lastError || new Error('Operation failed after retries');
  }

  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Operation timeout'));
      }, timeout);

      promise
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  addListener(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.push(listener);
    listener(this.status); // Notify immediately with current status

    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.status);
      } catch (error) {
        console.error('Listener error:', error);
      }
    });
  }

  getCurrentStatus(): NetworkStatus {
    return { ...this.status };
  }

  isConnectionStable(): boolean {
    return (
      this.status.isConnected &&
      this.status.isInternetReachable &&
      this.retryCount === 0
    );
  }

  updateConfig(newConfig: Partial<NetworkConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.listeners = [];
  }

  async testConnection(url?: string): Promise<{
    success: boolean;
    latency?: number;
    error?: string;
  }> {
    const testUrl = url || 'https://www.google.com';
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(testUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      return {
        success: response.ok,
        latency,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Connection test failed',
      };
    }
  }
}

export const networkService = NetworkService.getInstance();
