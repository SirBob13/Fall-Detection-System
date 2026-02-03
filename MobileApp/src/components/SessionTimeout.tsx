// src/components/SessionTimeout.tsx
import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { authService } from '../services/auth.service';

interface SessionTimeoutProps {
  timeoutMinutes?: number;
  onTimeout?: () => void;
}

export const SessionTimeout: React.FC<SessionTimeoutProps> = ({
  timeoutMinutes = 30,
  onTimeout,
}) => {
  const appState = useRef(AppState.currentState);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // التطبيق عاد للنشاط، تحقق من مدة الخمول
        const inactiveTime = Date.now() - lastActivity.current;
        const timeoutMs = timeoutMinutes * 60 * 1000;
        
        if (inactiveTime > timeoutMs) {
          // انتهت الجلسة
          authService.logout();
          onTimeout?.();
        } else {
          // تحديث آخر نشاط
          lastActivity.current = Date.now();
          authService.updateLastActivity();
        }
      } else if (nextAppState.match(/inactive|background/)) {
        // التطبيق أصبح غير نشط
        lastActivity.current = Date.now();
      }
      
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    // تحديث النشاط عند التفاعل مع الشاشة
    const updateActivity = () => {
      lastActivity.current = Date.now();
      authService.updateLastActivity();
    };

    // استمع لأحداث اللمس
    const events = ['touchstart', 'mousedown', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, updateActivity);
    });

    return () => {
      subscription.remove();
      events.forEach(event => {
        document.removeEventListener(event, updateActivity);
      });
    };
  }, [timeoutMinutes, onTimeout]);

  return null; // هذا مكون غير مرئي
};