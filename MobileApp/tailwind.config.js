/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: [
    './App.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './screens/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2196F3',
        secondary: '#FF4081',
        success: '#4CAF50',
        warning: '#FF9800',
        danger: '#F44336',
        info: '#00BCD4',
        dark: '#212121',
        gray: '#757575',
        lightGray: '#BDBDBD',
        light: '#F5F5F5',
        white: '#FFFFFF',
        black: '#000000',
        // يمكنك إضافة ألوان إضافية لمشروع الإسعافات
        emergency: '#D32F2F',
        safe: '#388E3C',
        caution: '#FFA000',
        darkTheme: {
          primary: '#0A84FF',
          background: '#000000',
          surface: '#1C1C1E',
          text: '#FFFFFF',
        },
      },
      spacing: {
        '18': '72px',
        '22': '88px',
        '26': '104px',
        '30': '120px',
        '34': '136px',
        '38': '152px',
        '42': '168px',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
        full: '9999px',
      },
      fontSize: {
        xxs: '10px',
        '2xs': '11px',
        '3xs': '9px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
        DEFAULT: '0 2px 4px rgba(0, 0, 0, 0.1)',
        md: '0 4px 6px rgba(0, 0, 0, 0.1)',
        lg: '0 8px 12px rgba(0, 0, 0, 0.12)',
        xl: '0 12px 20px rgba(0, 0, 0, 0.12)',
        '2xl': '0 20px 32px rgba(0, 0, 0, 0.15)',
        none: 'none',
        // ظلال مخصصة لمشروع الإسعافات (قيم مبسطة متوافقة مع React Native)
        emergency: '0 0px 8px rgba(244, 67, 54, 0.35)',
        card: '0 6px 12px rgba(0, 0, 0, 0.12)',
        button: '0 4px 8px rgba(33, 150, 243, 0.25)',
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        bounce: 'bounce 1s infinite',
        'spin-slow': 'spin 3s linear infinite',
        'ping-slow': 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'fade-out': 'fadeOut 0.5s ease-in-out',
        'slide-in-up': 'slideInUp 0.3s ease-out',
        'slide-in-down': 'slideInDown 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        shake: 'shake 0.5s ease-in-out',
        'emergency-pulse': 'emergencyPulse 1.5s ease-in-out infinite',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
        bounce: {
          '0%, 100%': {
            transform: 'translateY(-25%)',
            animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)',
          },
          '50%': {
            transform: 'translateY(0)',
            animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)',
          },
        },
        spin: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        ping: {
          '75%, 100%': {
            transform: 'scale(2)',
            opacity: '0',
          },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeOut: {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        slideInUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        slideInDown: {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' },
        },
        emergencyPulse: {
          '0%, 100%': {
            boxShadow: '0 0 0 0 rgba(244, 67, 54, 0.7)',
            transform: 'scale(1)',
          },
          '50%': {
            boxShadow: '0 0 0 20px rgba(244, 67, 54, 0)',
            transform: 'scale(1.05)',
          },
        },
      },
      transitionDuration: {
        0: '0ms',
        75: '75ms',
        100: '100ms',
        150: '150ms',
        200: '200ms',
        300: '300ms',
        500: '500ms',
        700: '700ms',
        1000: '1000ms',
      },
      transitionTimingFunction: {
        emergency: 'cubic-bezier(0.4, 0, 0.2, 1)',
        'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      opacity: {
        15: '0.15',
        35: '0.35',
        65: '0.65',
        85: '0.85',
      },
      zIndex: {
        60: '60',
        70: '70',
        80: '80',
        90: '90',
        100: '100',
        max: '9999',
      },
      borderWidth: {
        3: '3px',
        5: '5px',
        6: '6px',
      },
      fontFamily: {
        'sans-arabic': ['Cairo', 'Arial', 'sans-serif'],
        'sans-english': ['Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      const newUtilities = {
        '.text-start': {
          'text-align': 'start',
        },
        '.text-end': {
          'text-align': 'end',
        },
        '.flex-row-reverse-rtl': {
          '@apply flex-row-reverse': {},
        },
        '.rtl\\:mr-auto': {
          'margin-right': 'auto',
        },
        '.rtl\\:ml-auto': {
          'margin-left': 'auto',
        },
      };
      addUtilities(newUtilities, ['responsive', 'hover']);
    },
  ],
  corePlugins: {
    preflight: false,
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : {
        safelist: [
          'text-right',
          'text-left',
          'flex-row-reverse',
          'border-r-2',
          'border-l-2',
          'mr-*',
          'ml-*',
          'pr-*',
          'pl-*',
          'rtl:*',
        ],
      }),
};
