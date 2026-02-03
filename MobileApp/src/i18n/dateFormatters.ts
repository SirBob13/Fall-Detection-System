// src/i18n/dateFormatters.ts
import i18n from './index';
import { format, formatDistance } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

export const formatDate = (date: Date) => {
  const locale = i18n.language === 'ar' ? ar : enUS;
  return format(date, 'PPP', { locale });
};