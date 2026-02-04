import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { networkService } from './network.service';

export interface AnalyticsEvent {
  name: string;
  timestamp: string;
  properties?: Record<string, any>;
  userId?: string;
  sessionId: string;
  deviceInfo: DeviceInfo;
}

export interface DeviceInfo {
  platform: string;
  version: string;
  deviceModel: string;
  deviceId: string;
  appVersion: string;
}

export interface AnalyticsConfig {
  enabled: boolean;
  flushInterval: number;
  maxQueueSize: number;
  serverUrl: string;
  debug: boolean;
}

export class AnalyticsService {
  private static instance: AnalyticsService;
  private queue: AnalyticsEvent[] = [];
  private sessionId: string;
  private deviceInfo: DeviceInfo;
  private userProperties: Record<string, any> = {};
  private config: AnalyticsConfig = {
    enabled: true,
    flushInterval: 30000, // 30 seconds
    maxQueueSize: 100,
    serverUrl: 'https://analytics.example.com/api/events',
    debug: __DEV__,
  };
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly STORAGE_KEY = '@analytics_queue';

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  private constructor() {
    this.sessionId = this.generateSessionId();
    this.deviceInfo = this.getDeviceInfo();
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Load queued events from storage
    await this.loadQueueFromStorage();
    
    // Start periodic flush
    this.startFlushInterval();
    
    // Track session start
    this.track('session_start', {
      platform: this.deviceInfo.platform,
      app_version: this.deviceInfo.appVersion,
    });
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDeviceInfo(): DeviceInfo {
    return {
      platform: Platform.OS,
      version: Platform.Version.toString(),
      deviceModel: Platform.constants?.Model || 'Unknown',
      deviceId: this.getDeviceId(),
      appVersion: '1.0.0', // Should be from app config
    };
  }

  private getDeviceId(): string {
    // In production, use a proper device ID
    const storedId = AsyncStorage.getItem('@device_id');
    if (!storedId) {
      const newId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      AsyncStorage.setItem('@device_id', newId);
      return newId;
    }
    return storedId;
  }

  track(eventName: string, properties?: Record<string, any>, userId?: string): void {
    if (!this.config.enabled) return;

    const event: AnalyticsEvent = {
      name: eventName,
      timestamp: new Date().toISOString(),
      properties,
      userId,
      sessionId: this.sessionId,
      deviceInfo: this.deviceInfo,
    };

    this.queue.push(event);
    
    // Log in debug mode
    if (this.config.debug) {
      console.log(`📊 [Analytics] Track: ${eventName}`, properties);
    }

    // Check if we need to flush
    if (this.queue.length >= this.config.maxQueueSize) {
      this.flush();
    }

    // Save to storage
    this.saveQueueToStorage();
  }

  screenView(screenName: string, properties?: Record<string, any>): void {
    this.track('screen_view', {
      screen_name: screenName,
      ...properties,
    });
  }

  error(error: Error, context?: Record<string, any>): void {
    this.track('error', {
      error_message: error.message,
      error_stack: error.stack,
      error_name: error.name,
      context,
    });
  }

  userAction(action: string, details?: Record<string, any>): void {
    this.track('user_action', {
      action,
      ...details,
    });
  }

  performance(metric: string, value: number, details?: Record<string, any>): void {
    this.track('performance', {
      metric,
      value,
      unit: 'ms',
      ...details,
    });
  }

  private async flush(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.queue.length === 0) return;

    const eventsToSend = [...this.queue];
    this.queue = [];

    try {
      // Skip flushing if server URL is not configured (common in dev)
      if (
        !this.config.serverUrl ||
        this.config.serverUrl.includes('analytics.example.com')
      ) {
        if (this.config.debug) {
          console.warn('📊 [Analytics] Server URL not configured, skipping flush');
        }
        // Re-queue events to avoid losing data
        this.queue = [...eventsToSend, ...this.queue];
        return;
      }

      // Check network connectivity
      const isConnected = await networkService.checkConnectivity();
      if (!isConnected) {
        // Re-queue events if no connection
        this.queue = [...eventsToSend, ...this.queue];
        return;
      }

      // Send events to server
      const response = await fetch(this.config.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': this.deviceInfo.deviceId,
        },
        body: JSON.stringify({
          events: eventsToSend,
          sent_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Analytics server returned ${response.status}`);
      }

      // Clear storage on successful send
      await AsyncStorage.removeItem(this.STORAGE_KEY);

      if (this.config.debug) {
        console.log(`📊 [Analytics] Flushed ${eventsToSend.length} events`);
      }
    } catch (error) {
      // Avoid red-screen in dev for non-critical analytics failures
      if (this.config.debug) {
        console.warn('📊 [Analytics] Flush failed:', error);
      }
      
      // Re-queue events on failure
      this.queue = [...eventsToSend, ...this.queue];
      await this.saveQueueToStorage();
    }
  }

  private async saveQueueToStorage(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(this.queue.slice(-50)) // Keep only last 50 events
      );
    } catch (error) {
      console.error('Save analytics queue error:', error);
    }
  }

  private async loadQueueFromStorage(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const storedEvents = JSON.parse(stored) as AnalyticsEvent[];
        this.queue = [...storedEvents, ...this.queue];
      }
    } catch (error) {
      console.error('Load analytics queue error:', error);
    }
  }

  private startFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  updateConfig(newConfig: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  setUserId(userId: string): void {
    // Track user identification
    this.track('user_identified', { user_id: userId }, userId);
  }

  setUserProperties(properties: Record<string, any>): void {
    if (!properties || typeof properties !== 'object') return;
    this.userProperties = { ...this.userProperties, ...properties };

    // Track user properties update (non-blocking)
    this.track('user_properties_updated', { ...this.userProperties });
  }

  async flushImmediately(): Promise<void> {
    return this.flush();
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Flush any remaining events
    this.flushImmediately().catch(() => {
      // Ignore errors during destruction
    });
  }
}

export const analyticsService = AnalyticsService.getInstance();
