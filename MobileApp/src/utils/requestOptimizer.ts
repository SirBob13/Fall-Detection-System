// src/utils/requestOptimizer.ts
export class RequestOptimizer {
  private static instance: RequestOptimizer;
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheDuration: number = 30000; // 30 ثانية

  static getInstance(): RequestOptimizer {
    if (!RequestOptimizer.instance) {
      RequestOptimizer.instance = new RequestOptimizer();
    }
    return RequestOptimizer.instance;
  }

  async request<T>(
    key: string,
    requestFn: () => Promise<T>,
    useCache: boolean = true
  ): Promise<T> {
    // التحقق من الكاش أولاً
    if (useCache) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
        console.log(`📦 Using cached data for: ${key}`);
        return cached.data;
      }
    }

    // منع الطلبات المتكررة
    if (this.pendingRequests.has(key)) {
      console.log(`⏳ Request already pending for: ${key}`);
      return await this.pendingRequests.get(key)!;
    }

    // إنشاء طلب جديد
    const promise = (async () => {
      try {
        const result = await requestFn();
        
        // حفظ في الكاش
        if (useCache) {
          this.cache.set(key, {
            data: result,
            timestamp: Date.now()
          });
        }
        
        return result;
      } finally {
        // إزالة من الطلبات المعلقة
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, promise);
    return await promise;
  }

  clearCache(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  invalidateKey(key: string): void {
    this.cache.delete(key);
    this.pendingRequests.delete(key);
  }
}

export const requestOptimizer = RequestOptimizer.getInstance();