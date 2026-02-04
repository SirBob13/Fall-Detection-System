// src/services/socket.service.ts
import io from 'socket.io-client';
import { API_CONFIG } from '../utils/constants';

export class SocketService {
  private socket: any;
  
  connect(userId: string) {
    const socketUrl = API_CONFIG.BASE_URL.replace('/api/v1', '');
    this.socket = io(socketUrl, {
      auth: { userId },
      transports: ['websocket'],
    });
    
    this.socket.on('new-alert', (alert) => {
      // Handle real-time alert
    });
  }
}
