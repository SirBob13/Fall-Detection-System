# Bluetooth ESP Fix - Progress Tracker

## Plan Steps (Approved ✅)

### 1. Create TODO.md [COMPLETED]

### 2. Update constants.ts (Fix CHARACTERISTIC_UUID)
- ✅ Updated: CHARACTERISTIC_UUID → '7A100004...' (ESP status char)

### 3. Update app.json (Add EXPO_PUBLIC_ env vars)
- ✅ Added all BLE UUID env vars to extra

### 4. Enhance bleGateway.service.ts (Better logging)
- ✅ Added debug logs for raw/decoded payloads

### 4. Enhance bleGateway.service.ts (Better logging)
- [ ] Add subscription checks & payload debug logs

### 5. Test Flow
- [ ] Build dev client: `expo run:android` or `ios`
- [ ] Settings → Device Mgmt → Scan → Connect ESP
- [ ] Verify provisioning & data ingest in logs
- [ ] Backend receives MQTT after WiFi provision

### 6. Optional: Enhance ESP firmware
- [ ] Add dedicated data char if needed

**Current Status**: Starting code edits...

