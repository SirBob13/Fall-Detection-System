const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const ARABIC_CHAR_MAP: Record<string, string> = {
  'ا': 'a',
  'أ': 'a',
  'إ': 'i',
  'آ': 'aa',
  'ب': 'b',
  'ت': 't',
  'ث': 'th',
  'ج': 'j',
  'ح': 'h',
  'خ': 'kh',
  'د': 'd',
  'ذ': 'dh',
  'ر': 'r',
  'ز': 'z',
  'س': 's',
  'ش': 'sh',
  'ص': 's',
  'ض': 'd',
  'ط': 't',
  'ظ': 'z',
  'ع': 'a',
  'غ': 'gh',
  'ف': 'f',
  'ق': 'q',
  'ك': 'k',
  'ل': 'l',
  'م': 'm',
  'ن': 'n',
  'ه': 'h',
  'و': 'w',
  'ي': 'y',
  'ى': 'a',
  'ة': 'a',
  'ئ': 'y',
  'ؤ': 'w',
  'ء': '',
  'ٓ': '',
  'ـ': '',
};

export const transliterateArabic = (input: string): string => {
  if (!input) return '';

  const stripped = input.replace(ARABIC_DIACRITICS, '');
  let output = '';

  for (const char of stripped) {
    output += ARABIC_CHAR_MAP[char] ?? char;
  }

  return output;
};
