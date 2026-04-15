// src/i18n/dateFormatters.ts
import i18n from './index';

export const formatDate = (date: Date) => {
  const locale = i18n.language === 'ar' ? 'ar-EG' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
};
