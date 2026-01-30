import { Alert } from '../types';
import { getCurrentLanguage } from '../i18n';

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = Math.abs(now.getTime() - date.getTime()) / 36e5;
  
  const lang = getCurrentLanguage();

  if (diffInHours < 1) {
    const diffInMinutes = Math.floor(diffInHours * 60);
    if (lang === 'ar') {
      return `قبل ${diffInMinutes} دقيقة`;
    } else {
      return `${diffInMinutes} minutes ago`;
    }
  } else if (diffInHours < 24) {
    const hours = Math.floor(diffInHours);
    if (lang === 'ar') {
      return `قبل ${hours} ساعة`;
    } else {
      return `${hours} hours ago`;
    }
  } else if (diffInHours < 168) {
    const days = Math.floor(diffInHours / 24);
    if (lang === 'ar') {
      return `قبل ${days} يوم`;
    } else {
      return `${days} days ago`;
    }
  } else {
    if (lang === 'ar') {
      return date.toLocaleDateString('ar-EG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } else {
      return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
  }
};

export const getSeverityColor = (severity: Alert['severity']): string => {
  switch (severity) {
    case 'critical':
      return '#F44336';
    case 'high':
      return '#FF5722';
    case 'medium':
      return '#FF9800';
    case 'low':
      return '#2196F3';
    default:
      return '#9E9E9E';
  }
};

export const getAlertIcon = (alertType: Alert['alert_type']): string => {
  switch (alertType) {
    case 'fall':
      return 'alert-octagon';
    case 'vital_abnormal':
      return 'heart-pulse';
    case 'device_offline':
      return 'wifi-off';
    default:
      return 'alert-circle';
  }
};

export const validatePhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
};

export const calculateFallRiskLevel = (probability: number): {
  level: 'low' | 'medium' | 'high';
  color: string;
  text: string;
} => {
  const lang = getCurrentLanguage();
  
  if (probability >= 0.7) {
    return { 
      level: 'high', 
      color: '#F44336', 
      text: lang === 'ar' ? 'خطر مرتفع' : 'High Risk' 
    };
  } else if (probability >= 0.4) {
    return { 
      level: 'medium', 
      color: '#FF9800', 
      text: lang === 'ar' ? 'خطر متوسط' : 'Medium Risk' 
    };
  } else {
    return { 
      level: 'low', 
      color: '#4CAF50', 
      text: lang === 'ar' ? 'خطر منخفض' : 'Low Risk' 
    };
  }
};

export const truncateText = (text: string, maxLength: number = 100): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};