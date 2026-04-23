# Fall Detection — Mobile App (Expo / React Native)

## المتطلبات

- Node.js 20+ (يفضّل LTS)
- حساب Expo (للبناء السحابي EAS اختياريًا)
- **Bluetooth (BLE):** لازم **development build** — تطبيق **Expo Go** لا يدعم `react-native-ble-plx` بالكامل

## الإعداد

من مجلد `MobileApp/`:

```bash
npm install
```

### متغيرات البيئة

```bash
cp .env.example .env
```

عدّل `EXPO_PUBLIC_API_URL` و `API_URL` ليطابقا عنوان الـ Backend (مثلاً `https://fall-detection.ddns.net`).

## التشغيل أثناء التطوير

```bash
npx expo start
```

ثم افتح التطبيق على **محاكي / جهاز** بعد تثبيت **dev client** (انظر البناء أدناه).

## بناء Android محليًا (APK release)

بعد `npx expo prebuild` أو وجود مجلد `android/`:

```bash
cd android
./gradlew assembleRelease
```

مخرجات الـ APK:

`android/app/build/outputs/apk/release/app-release.apk`

## بناء عبر EAS (سحابي)

```bash
npx eas-cli login
npx eas-cli build --platform android --profile production
```

الإعدادات في `eas.json` و `app.json` (`extra.eas.projectId`).

## ملاحظات BLE

- فعّل **الموقع** على أندرويد إذا طلب التطبيق ذلك (مسح BLE).
- تأكد أن الـ firmware يعلن الاسم المتوقع (مثل `FallDetectionBracelet`) وأن UUIDs في `src/utils/constants.ts` تطابق الـ hardware.

## المزيد

- وصف المشروع الكامل: `../README.md`
- الـ Backend: `../Backend/`
