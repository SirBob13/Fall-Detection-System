import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDQTrDAKlm-VSL9Qyr6mmuwSI2boaDVtZQ',
  authDomain: 'fall-detection-1b77c.firebaseapp.com',
  projectId: 'fall-detection-1b77c',
  storageBucket: 'fall-detection-1b77c.firebasestorage.app',
  messagingSenderId: '377081293473',
  appId: '1:377081293473:web:cc622fd38d96e46b901ee0',
  measurementId: 'G-EJKS6SD6EP',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firestore = getFirestore(app);
