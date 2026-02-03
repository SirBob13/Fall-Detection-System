// src/services/security.service.ts
import CryptoJS from 'crypto-js';

export class SecurityService {
  private static SECRET_KEY = process.env.ENCRYPTION_KEY || 'fall-detection-secure-key';

  static encryptData(data: any): string {
    return CryptoJS.AES.encrypt(JSON.stringify(data), this.SECRET_KEY).toString();
  }

  static decryptData(encrypted: string): any {
    const bytes = CryptoJS.AES.decrypt(encrypted, this.SECRET_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  }

  static hashPassword(password: string): string {
    return CryptoJS.SHA512(password).toString();
  }
}