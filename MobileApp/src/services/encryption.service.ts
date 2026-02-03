// src/services/encryption.service.ts
import CryptoJS from 'crypto-js';

const SECRET_KEY = 'your-secret-key-here'; // يجب تخزينه بشكل آمن

export class EncryptionService {
  static encrypt(data: any): string {
    try {
      const encrypted = CryptoJS.AES.encrypt(
        JSON.stringify(data),
        SECRET_KEY
      ).toString();
      return encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      throw error;
    }
  }

  static decrypt(encryptedData: string): any {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, SECRET_KEY);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
      throw error;
    }
  }

  static hashPassword(password: string): string {
    return CryptoJS.SHA256(password).toString();
  }
}