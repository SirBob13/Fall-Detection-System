import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CacheItem<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
  version: string;
  metadata?: Record<string, any>;
}

export interface CacheConfig {
  defaultTTL: number; // milliseconds
  maxSize: number;
  version: string;
  cleanupInterval: number;
}

export class CacheService {
  private static instance: CacheService;
  private cache: Map<string, CacheItem> = new Map();
  private config: CacheConfig = {
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    maxSize: 1000,
    version: '1.0',
    cleanupInterval: 10 * 60 * 1000, // 10 minutes
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly STORAGE_KEY = '@app_cache';

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadFromStorage();
    this.startCleanupInterval();
  }

  async set<T>(
    key: string,
    data: T,
    options?: {
      ttl?: number;
      version?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const now = Date.now();
    const ttl = options?.ttl || this.config.defaultTTL;

    const cacheItem: CacheItem<T> = {
      data,
      timestamp: now,
      expiresAt: now + ttl,
      version: options?.version || this.config.version,
      metadata: options?.metadata,
    };

    this.cache.set(key, cacheItem);

    // Save to storage if important
    if (this.isImportantKey(key)) {
      await this.saveToStorage();
    }

    // Check size limit
    if (this.cache.size > this.config.maxSize) {
      this.cleanup(true); // Aggressive cleanup
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key) as CacheItem<T> | undefined;

    if (!item) {
      return null;
    }

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Check version
    if (item.version !== this.config.version) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: {
      ttl?: number;
      version?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<T> {
    const cached = await this.get<T>(key);
    
    if (cached !== null) {
      return cached;
    }

    const freshData = await fetcher();
    await this.set(key, freshData, options);
    
    return freshData;
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    
    if (this.isImportantKey(key)) {
      await this.saveToStorage();
    }
  }

  async clear(): Promise<void> {
    this.cache.clear();
    await AsyncStorage.removeItem(this.STORAGE_KEY);
  }

  async invalidate(pattern: string | RegExp): Promise<void> {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (typeof pattern === 'string') {
        if (key.includes(pattern)) {
          keysToDelete.push(key);
        }
      } else if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    await this.saveToStorage();
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;
    
    // Check expiration
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    // Simple stats implementation
    return {
      size: this.cache.size,
      hits: 0, // Would need to track hits/misses
      misses: 0,
      hitRate: 0,
    };
  }

  private async saveToStorage(): Promise<void> {
    try {
      const importantData: Record<string, CacheItem> = {};
      
      for (const [key, item] of this.cache.entries()) {
        if (this.isImportantKey(key)) {
          importantData[key] = item;
        }
      }

      await AsyncStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(importantData)
      );
    } catch (error) {
      console.error('Cache save error:', error);
    }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const storedCache = JSON.parse(stored) as Record<string, CacheItem>;
        const now = Date.now();

        for (const [key, item] of Object.entries(storedCache)) {
          // Only load non-expired items
          if (now <= item.expiresAt) {
            this.cache.set(key, item);
          }
        }
      }
    } catch (error) {
      console.error('Cache load error:', error);
    }
  }

  private isImportantKey(key: string): boolean {
    // Define which keys should be persisted
    return key.startsWith('user_') || 
           key.startsWith('settings_') || 
           key.startsWith('emergency_');
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  private cleanup(aggressive: boolean = false): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      // Remove expired items
      if (now > item.expiresAt) {
        keysToDelete.push(key);
        continue;
      }

      // Remove old items in aggressive mode
      if (aggressive && now - item.timestamp > this.config.defaultTTL * 3) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    // Remove excess items
    if (this.cache.size > this.config.maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const excess = entries.slice(0, entries.length - this.config.maxSize);
      for (const [key] of excess) {
        this.cache.delete(key);
      }
    }
  }

  updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const cacheService = CacheService.getInstance();