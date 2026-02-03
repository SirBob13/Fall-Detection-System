// src/services/socket.service.ts
import io from 'socket.io-client';

export class SocketService {
  private socket: any;
  
  connect(userId: string) {
    this.socket = io(API_CONFIG.BASE_URL, {
      auth: { userId },
      transports: ['websocket'],
    });
    
    this.socket.on('new-alert', (alert) => {
      // Handle real-time alert
    });
  }
}