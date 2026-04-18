import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { API_CONFIG } from '../utils/constants';
import { 
  User, Device, VitalData, 
  Prediction, Alert, ApiResponse, CareLink, CareLinkRequest, DeviceIngestPayload, LastKnownLocation, CareDashboardItem, ReportSummary,
  DevicePairingTokenRequest, DevicePairingTokenResponse
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

  private normalizeAlert(raw: any, userId?: number): Alert {
    const status = raw?.status === 'active' ? 'pending' : raw?.status;

    return {
      id: raw?.id,
      user_id: raw?.user_id ?? userId ?? 0,
      prediction_id: raw?.prediction_id ?? undefined,
      timestamp: raw?.timestamp,
      alert_type: raw?.alert_type || raw?.type || 'fall',
      severity: raw?.severity || 'medium',
      message: raw?.message || '',
      status: status || 'pending',
      sent_to: raw?.sent_to,
      acknowledged_by: raw?.acknowledged_by,
      acknowledged_at: raw?.acknowledged_at,
      resolved_at: raw?.resolved_at,
    };
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
      const response = await this.client.get(`/users/${userId}`);
      const payload = response.data;
      const user = payload?.data ?? payload?.user ?? payload;
      return { success: payload?.success ?? true, data: user };
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
      const response = await this.client.put(`/users/${userId}`, userData);
      const payload = response.data;
      const user = payload?.data ?? payload?.user ?? payload;
      return { success: payload?.success ?? true, data: user, message: payload?.message };
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
        data: response.data?.data ?? response.data 
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
      const response = await this.client.get(`/alerts/${userId}?limit=${limit}`);
      const payload = response.data;
      const rawAlerts = Array.isArray(payload?.alerts)
        ? payload.alerts
        : Array.isArray(payload?.data)
        ? payload.data
        : [];
      const alerts = rawAlerts.map((alert: any) => this.normalizeAlert(alert, userId));
      return { success: payload?.success ?? true, data: alerts };
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

  async getLastLocation(userId: number): Promise<ApiResponse<LastKnownLocation | null>> {
    try {
      const response = await this.client.get(`/emergency/last-location/${userId}`);
      const payload = response.data;
      const data = payload?.data ?? null;
      return { success: payload?.success ?? true, data };
    } catch (error: any) {
      const status = error?.response?.status;
      console.error(`❌ Error getting last location (${userId}):`, status ?? '', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل آخر موقع'
      };
    }
  }

  async getUserReport(userId: number, days: number = 7): Promise<ApiResponse<ReportSummary>> {
    try {
      const response = await this.client.get(`/reports/${userId}?days=${days}`);
      const payload = response.data;
      const data = payload?.data ?? payload;
      return { success: payload?.success ?? true, data };
    } catch (error: any) {
      console.error('❌ Error getting report:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل التقرير'
      };
    }
  }

  // Device APIs - NO MOCK DATA
  async getDevice(deviceId: string): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.get(`/devices/${deviceId}`);
      const payload = response.data;
      const device = payload?.data ?? payload?.device ?? payload;
      return { success: payload?.success ?? true, data: device };
    } catch (error: any) {
      console.error('❌ Error getting device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل بيانات الجهاز'
      };
    }
  }

  async getUserDevice(userId: number): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.get(`/devices/user/${userId}`);
      const payload = response.data;
      const device = payload?.data ?? payload?.device ?? payload;
      return { success: payload?.success ?? true, data: device };
    } catch (error: any) {
      if (error?.response?.status === 404) {
        console.log(`ℹ️ No active device assigned for user ${userId}`);
        return {
          success: true,
          data: undefined,
          message: 'لا يوجد جهاز مرتبط بهذا المستخدم'
        };
      }

      console.warn('⚠️ Error getting user device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل بيانات الجهاز'
      };
    }
  }

  async getUserDevices(userId: number): Promise<ApiResponse<Device[]>> {
    try {
      const response = await this.client.get(`/devices/user/${userId}/all`);
      const payload = response.data;
      const devices = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.devices)
        ? payload.devices
        : [];
      return { success: payload?.success ?? true, data: devices };
    } catch (error: any) {
      console.error('❌ Error getting user devices:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل بيانات الأجهزة'
      };
    }
  }

  async getArchivedDevices(userId: number): Promise<ApiResponse<Device[]>> {
    try {
      const response = await this.client.get(`/devices/user/${userId}/archived`);
      const payload = response.data;
      const devices = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.devices)
        ? payload.devices
        : [];
      return { success: payload?.success ?? true, data: devices };
    } catch (error: any) {
      console.error('❌ Error getting archived devices:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل الأجهزة المؤرشفة'
      };
    }
  }

  async connectDevice(payload: {
    user_id: number;
    device_id: string;
    mac_address?: string;
    firmware_version?: string;
    battery_level?: number;
  }): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.post('/devices/connect', payload);
      const data = response.data;
      const device = data?.data ?? data?.device ?? data;
      return { success: data?.success ?? true, data: device, message: data?.message };
    } catch (error: any) {
      console.error('❌ Error connecting device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل ربط الجهاز'
      };
    }
  }

  async requestDevicePairingToken(
    payload: DevicePairingTokenRequest
  ): Promise<ApiResponse<DevicePairingTokenResponse>> {
    try {
      const response = await this.client.post('/devices/request-pairing-token', payload);
      const data = response.data;
      return {
        success: data?.success ?? true,
        data,
        message: data?.message,
      };
    } catch (error: any) {
      console.error('❌ Error requesting pairing token:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل إنشاء رمز ربط الجهاز'
      };
    }
  }

  async disconnectDevice(deviceId: string): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.post('/devices/disconnect', { device_id: deviceId });
      const data = response.data;
      const device = data?.data ?? data?.device ?? data;
      return { success: data?.success ?? true, data: device, message: data?.message };
    } catch (error: any) {
      console.error('❌ Error disconnecting device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل فصل الجهاز'
      };
    }
  }

  async removeDevice(deviceId: string, userId?: number): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.delete(`/devices/${deviceId}`, {
        params: userId ? { user_id: userId } : undefined
      });
      const data = response.data;
      const device = data?.data ?? data?.device ?? data;
      return { success: data?.success ?? true, data: device, message: data?.message };
    } catch (error: any) {
      console.error('❌ Error removing device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل إزالة الجهاز'
      };
    }
  }

  async restoreDevice(deviceId: string, userId?: number): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.post(`/devices/${deviceId}/restore`, null, {
        params: userId ? { user_id: userId } : undefined
      });
      const data = response.data;
      const device = data?.data ?? data?.device ?? data;
      return { success: data?.success ?? true, data: device, message: data?.message };
    } catch (error: any) {
      console.error('❌ Error restoring device:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل استعادة الجهاز'
      };
    }
  }

  async getUserPredictions(userId: number, limit: number = 1): Promise<ApiResponse<Prediction[]>> {
    try {
      const response = await this.client.get(`/predictions/${userId}?limit=${limit}`);
      const payload = response.data;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return { success: payload?.success ?? true, data };
    } catch (error: any) {
      console.error('❌ Error getting predictions:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل التنبؤات'
      };
    }
  }

  async getUserVitals(userId: number, limit: number = 1): Promise<ApiResponse<VitalData[]>> {
    try {
      const response = await this.client.get(`/vitals/${userId}?limit=${limit}`);
      const payload = response.data;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return { success: payload?.success ?? true, data };
    } catch (error: any) {
      console.error('❌ Error getting vitals:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل المؤشرات الحيوية'
      };
    }
  }

  // Caregiver / Monitoring APIs
  async getCareLinks(caregiverId: number): Promise<ApiResponse<CareLink[]>> {
    try {
      const response = await this.client.get(`/care/links/${caregiverId}`);
      const payload = response.data;
      const links = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.links) ? payload.links : [];
      return { success: payload?.success ?? true, data: links };
    } catch (error: any) {
      console.error('❌ Error getting care links:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل بيانات المتابعة'
      };
    }
  }

  async createCareLink(params: {
    caregiver_id: number;
    patient_email?: string;
    patient_phone?: string;
    patient_id?: number;
    relationship?: string;
  }): Promise<ApiResponse<CareLink>> {
    try {
      const response = await this.client.post(`/care/links`, params);
      const payload = response.data;
      const link = payload?.data ?? payload?.link ?? payload;
      return { success: payload?.success ?? true, data: link, message: payload?.message };
    } catch (error: any) {
      console.error('❌ Error creating care link:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل ربط الحساب'
      };
    }
  }

  async createCareRequest(params: {
    caregiver_id: number;
    patient_email?: string;
    patient_phone?: string;
    patient_id?: number;
    relationship?: string;
    message?: string;
  }): Promise<ApiResponse<CareLinkRequest>> {
    try {
      const response = await this.client.post(`/care/requests`, params);
      const payload = response.data;
      const request = payload?.data ?? payload?.request ?? payload;
      return { success: payload?.success ?? true, data: request, message: payload?.message };
    } catch (error: any) {
      console.error('❌ Error creating care request:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل إرسال طلب المتابعة'
      };
    }
  }

  async checkEmailExists(email: string): Promise<ApiResponse<{ exists: boolean; valid_format: boolean }>> {
    try {
      const response = await this.client.post(`/auth/check-email`, { email });
      const payload = response.data;
      return {
        success: true,
        data: {
          exists: !!payload?.exists,
          valid_format: payload?.valid_format !== false,
        },
      };
    } catch (error: any) {
      console.error('❌ Error checking email:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل التحقق من البريد الإلكتروني'
      };
    }
  }

  async checkPhoneExists(phone: string): Promise<ApiResponse<{ exists: boolean; valid_format: boolean }>> {
    try {
      const response = await this.client.post(`/auth/check-phone`, { phone });
      const payload = response.data;
      return {
        success: true,
        data: {
          exists: !!payload?.exists,
          valid_format: payload?.valid_format !== false,
        },
      };
    } catch (error: any) {
      console.error('❌ Error checking phone:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل التحقق من رقم الهاتف'
      };
    }
  }

  async getCareRequestsIncoming(patientId: number): Promise<ApiResponse<CareLinkRequest[]>> {
    try {
      const response = await this.client.get(`/care/requests/incoming/${patientId}`);
      const payload = response.data;
      const requests = Array.isArray(payload?.data) ? payload.data : [];
      return { success: payload?.success ?? true, data: requests };
    } catch (error: any) {
      console.error('❌ Error getting incoming care requests:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل طلبات المتابعة'
      };
    }
  }

  async getCareRequestsOutgoing(caregiverId: number): Promise<ApiResponse<CareLinkRequest[]>> {
    try {
      const response = await this.client.get(`/care/requests/outgoing/${caregiverId}`);
      const payload = response.data;
      const requests = Array.isArray(payload?.data) ? payload.data : [];
      return { success: payload?.success ?? true, data: requests };
    } catch (error: any) {
      console.error('❌ Error getting outgoing care requests:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل طلبات المتابعة'
      };
    }
  }

  async acceptCareRequest(requestId: number, patientId: number): Promise<ApiResponse<CareLinkRequest>> {
    try {
      const response = await this.client.post(`/care/requests/${requestId}/accept`, { patient_id: patientId });
      return response.data;
    } catch (error: any) {
      console.error('❌ Error accepting care request:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل قبول الطلب'
      };
    }
  }

  async rejectCareRequest(requestId: number, patientId: number): Promise<ApiResponse<CareLinkRequest>> {
    try {
      const response = await this.client.post(`/care/requests/${requestId}/reject`, { patient_id: patientId });
      return response.data;
    } catch (error: any) {
      console.error('❌ Error rejecting care request:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل رفض الطلب'
      };
    }
  }

  async cancelCareRequest(requestId: number, caregiverId: number): Promise<ApiResponse<CareLinkRequest>> {
    try {
      const response = await this.client.post(`/care/requests/${requestId}/cancel`, { caregiver_id: caregiverId });
      return response.data;
    } catch (error: any) {
      console.error('❌ Error cancelling care request:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل إلغاء الطلب'
      };
    }
  }

  async deleteCareLink(linkId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete(`/care/links/${linkId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error deleting care link:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل حذف الربط'
      };
    }
  }

  async getCareDashboard(caregiverId: number): Promise<ApiResponse<CareDashboardItem[]>> {
    try {
      const response = await this.client.get(`/care/dashboard/${caregiverId}`);
      const payload = response.data;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return { success: payload?.success ?? true, data };
    } catch (error: any) {
      console.error('❌ Error getting care dashboard:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل تحميل لوحة المتابعة'
      };
    }
  }

  // Device Ingest APIs (ESP32 / BLE)
  async ingestDeviceData(payload: DeviceIngestPayload): Promise<ApiResponse<any>> {
    try {
      const response = await this.client.post('/device-data', payload);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error ingesting device data:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل إرسال بيانات الجهاز'
      };
    }
  }

  async ingestDeviceDataBatch(items: DeviceIngestPayload[]): Promise<ApiResponse<any>> {
    try {
      const response = await this.client.post('/device-data/batch', { items });
      return response.data;
    } catch (error: any) {
      console.error('❌ Error ingesting device batch:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'فشل إرسال بيانات الجهاز (دفعة)'
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
