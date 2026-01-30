import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { API_CONFIG } from '../utils/constants';
import { 
  User, Device, MotionData, VitalData, 
  Prediction, Alert, ApiResponse 
} from '../types';

class ApiService {
  private client: AxiosInstance;
  private useMockData: boolean = false; // لا بيانات وهمية للمستخدمين

  constructor() {
    this.client = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      timeout: API_CONFIG.TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  // Health Check
  async healthCheck(): Promise<ApiResponse<{
    status: string;
    database: string;
    model_loaded: boolean;
  }>> {
    try {
      const response = await this.client.get('/health');
      return { 
        success: true, 
        data: response.data 
      };
    } catch (error: any) {
      console.error('❌ API connection failed:', error.message);
      return {
        success: false,
        error: 'Cannot connect to server',
        message: 'الخادم غير متوفر. يرجى التحقق من اتصال الإنترنت.'
      };
    }
  }

  // User APIs - NO MOCK DATA
  async getUser(userId: number): Promise<ApiResponse<User>> {
    try {
      const response: AxiosResponse<ApiResponse<User>> = await this.client.get(`/users/${userId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error getting user:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل بيانات المستخدم'
      };
    }
  }

  // ✅ التوابع الجديدة المطلوبة
  async updateUser(userId: number, userData: Partial<User>): Promise<ApiResponse<User>> {
    try {
      const response: AxiosResponse<ApiResponse<User>> = await this.client.put(
        `/users/${userId}`, 
        userData
      );
      return response.data;
    } catch (error: any) {
      console.error('❌ Error updating user:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحديث بيانات المستخدم'
      };
    }
  }

  async getSystemStats(): Promise<ApiResponse<any>> {
    try {
      const response = await this.client.get('/stats');
      return { 
        success: true, 
        data: response.data 
      };
    } catch (error: any) {
      console.error('❌ Error getting system stats:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل إحصائيات النظام'
      };
    }
  }

  // Alert APIs - NO MOCK DATA
  async getUserAlerts(
    userId: number,
    limit: number = 5
  ): Promise<ApiResponse<Alert[]>> {
    try {
      const response: AxiosResponse<ApiResponse<Alert[]>> = await this.client.get(
        `/users/${userId}/alerts?limit=${limit}`
      );
      return response.data;
    } catch (error: any) {
      console.error('❌ Error getting alerts:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل الإنذارات'
      };
    }
  }

  async acknowledgeAlert(
    alertId: number,
    acknowledgedBy: string
  ): Promise<ApiResponse<void>> {
    try {
      const response: AxiosResponse<ApiResponse<void>> = await this.client.post(
        `/alerts/${alertId}/acknowledge`, 
        { acknowledged_by: acknowledgedBy }
      );
      return response.data;
    } catch (error: any) {
      console.error('❌ Error acknowledging alert:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تأكيد الإنذار'
      };
    }
  }

  async resolveAlert(alertId: number): Promise<ApiResponse<void>> {
    try {
      const response: AxiosResponse<ApiResponse<void>> = await this.client.post(
        `/alerts/${alertId}/resolve`
      );
      return response.data;
    } catch (error: any) {
      console.error('❌ Error resolving alert:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل حل الإنذار'
      };
    }
  }

  // Device APIs - NO MOCK DATA
  async getDevice(deviceId: string): Promise<ApiResponse<Device>> {
    try {
      const response: AxiosResponse<ApiResponse<Device>> = await this.client.get(
        `/devices/${deviceId}`
      );
      return response.data;
    } catch (error: any) {
      console.error('❌ Error getting device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل بيانات الجهاز'
      };
    }
  }

  // Helper Methods
  private handleError(error: any): ApiResponse<any> {
    console.error('❌ API Error:', error.message);
    
    let errorMessage = 'حدث خطأ في الاتصال بالخادم';
    
    if (error.response) {
      // Server responded with error status
      errorMessage = error.response.data?.message || `خطأ ${error.response.status}`;
    } else if (error.request) {
      // No response received
      errorMessage = 'لا يمكن الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت.';
    }
    
    return {
      success: false,
      message: errorMessage,
      error: error.message,
    };
  }

  setAuthToken(token: string): void {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  clearAuthToken(): void {
    delete this.client.defaults.headers.common['Authorization'];
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.healthCheck();
      return response.success;
    } catch (error) {
      return false;
    }
  }
}

export const apiService = new ApiService();