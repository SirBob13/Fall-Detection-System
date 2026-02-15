import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './api';
import { networkService } from './network.service';
import { DeviceIngestPayload } from '../types';
import { STORAGE_KEYS } from '../utils/constants';

class OfflineQueueService {
  private queue: DeviceIngestPayload[] = [];
  private initialized = false;
  private isFlushing = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.loadQueue();

    // Subscribe to network changes
    networkService.addListener((status) => {
      if (status.isConnected && status.isInternetReachable) {
        this.flush().catch(() => undefined);
      }
    });

    // Try initial flush
    this.flush().catch(() => undefined);
  }

  private async loadQueue(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_QUEUE);
      this.queue = raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error('Offline queue load error:', error);
      this.queue = [];
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_QUEUE, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Offline queue save error:', error);
    }
  }

  async enqueue(payload: DeviceIngestPayload): Promise<void> {
    this.queue.push(payload);
    await this.saveQueue();

    const isConnected = await networkService.checkConnectivity();
    if (isConnected) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    try {
      const isConnected = await networkService.checkConnectivity();
      if (!isConnected) return;

      const MAX_BATCH = 50;
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, MAX_BATCH);
        const response = await apiService.ingestDeviceDataBatch(batch);
        if (response.success) {
          this.queue = this.queue.slice(batch.length);
          await this.saveQueue();
        } else {
          break; // keep queue if failed
        }
      }
    } catch (error) {
      console.warn('Offline queue flush failed:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}

export const offlineQueueService = new OfflineQueueService();
