export const formatPhoneNumber = (phone: string): string => {
  // تنسيق رقم الهاتف المصري
  if (phone.startsWith('+20')) {
    return phone.replace(/^(\+20)(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3 $4');
  }
  if (phone.startsWith('0')) {
    return phone.replace(/^0(\d{2})(\d{4})(\d{4})$/, '0$1 $2 $3 $4');
  }
  return phone;
};

export const formatDate = (date: Date, lang: 'ar' | 'en' = 'ar'): string => {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  
  return date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', options);
};

export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('ar-EG').format(num);
};