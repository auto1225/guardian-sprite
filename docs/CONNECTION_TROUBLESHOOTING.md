# 🔧 MeerCOP 연결 문제 트러블슈팅 가이드

## 📋 현재 상황 요약

스마트폰 앱에서 `get-devices` 호출 시 `user_id: 6d2a7599-...` (Supabase Auth)를 사용하고 있으나,
DB의 모든 기기는 `user_id: c4a4621e-...` (시리얼 시스템)로 등록되어 있어 빈 배열이 반환됨.

### 근본 원인
- 시리얼 세션 데이터(`meercop_serial_data`)의 `user_id`가 비어있거나
- Supabase Auth 세션이 존재하여 `effectiveUserId`가 Auth user_id로 폴백됨

---

## ✅ 스마트폰 앱 확인사항

### 1. localStorage 시리얼 데이터 확인
브라우저 DevTools → Application → Local Storage에서 확인:

| 키 | 기대값 |
|---|--------|
| `meercop_serial_key` | `HKXQ-XG7W-54NY` 등 유효한 시리얼 |
| `meercop_serial_data` | `{ "user_id": "c4a4621e-...", ... }` |

**핵심**: `meercop_serial_data`의 `user_id` 필드가 `c4a4621e-7b09-4c5c-825f-a3a11d855eb3`인지 확인

### 2. 웹사이트 verify-serial 응답 확인
Auth.tsx에서 `verify-serial` 호출 후 응답에 `user_id`가 포함되는지 확인:
```
[Auth] verify response: 200 { valid: true, serial: { user_id: "c4a4621e-...", ... } }
```

### 3. effectiveUserId 디버그 로그 확인
콘솔에서 `[Auth] effectiveUserId debug:` 로그 확인:
- `serialUserId`가 `c4a4621e-...`여야 함
- `authUserId`가 `6d2a7599-...`이더라도 `effectiveUserId`는 `serialUserId`를 우선해야 함

### 4. Supabase Auth 세션 제거 (필요 시)
시리얼 전용 인증이므로 Supabase Auth 세션이 불필요함. 
로그아웃 후 시리얼만으로 재인증 테스트.

---

## ✅ 랩탑(Broadcaster) 앱 확인사항

### 1. 시리얼 인증 확인
- `validate-serial` Edge Function 호출이 성공하는지 확인
- 응답의 `user_id`와 `device_id`가 올바른지 확인
- **이 프로젝트**(sltxwkdvaapyeosikegj)의 `validate-serial`을 호출하는지 확인

```
호출 URL: https://sltxwkdvaapyeosikegj.supabase.co/functions/v1/validate-serial
```

### 2. Presence 채널 구독 확인
- 채널명: `user-presence-${userId}` (user_id = `c4a4621e-...`)
- `key`: `deviceId` (예: `843adc55-...`)
- track 데이터에 `status`, `is_network_connected`, `is_camera_connected`, `battery_level` 포함

### 3. 하트비트 동작 확인
- 60초 주기로 `update-device` Edge Function 호출
- `last_seen_at` 갱신 확인
- `monitor-heartbeat`가 5분 이상 미응답 기기를 offline 처리

### 4. 명령 채널 수신 확인
- 채널명: `device-commands-${deviceId}`
- `monitoring_toggle`, `settings_updated` 이벤트 수신 테스트

### 5. DB 기기 레코드 확인
현재 DB의 기기 목록:

| 이름 | ID (앞 8자) | 타입 | user_id |
|------|-------------|------|---------|
| minho com | 843adc55 | laptop | c4a4621e |
| com2 | 3d9b2272 | tablet | c4a4621e |
| com3 | 75f973d9 | laptop | c4a4621e |
| 노트북 | db31c05b | laptop | c4a4621e |
| 내 스마트폰 | e506e00f | smartphone | c4a4621e |

**모든 기기가 `c4a4621e-...` user_id를 사용해야 함**

### 6. Edge Function URL 일치 확인
랩탑 앱이 호출하는 Edge Function URL이 이 프로젝트인지 확인:

```
✅ https://sltxwkdvaapyeosikegj.supabase.co/functions/v1/validate-serial
✅ https://sltxwkdvaapyeosikegj.supabase.co/functions/v1/update-device
✅ https://sltxwkdvaapyeosikegj.supabase.co/functions/v1/get-devices

❌ 다른 프로젝트 URL 사용 금지
```

### 7. Anon Key 일치 확인
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsdHh3a2R2YWFweWVvc2lrZWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjg4MjQsImV4cCI6MjA4NTg0NDgyNH0.hj6A8YDTRMQkPid9hfw6vnGC2eQLTmv2JPmQRLv4sZ4
```

---

## 🔄 데이터 흐름 확인

```
[스마트폰 시리얼 입력]
    ↓ verify-serial (웹사이트 DB: peqgmuicrorjvvburqly)
    ↓ → user_id: c4a4621e-..., serial 정보 수신
    ↓
[localStorage에 저장]
    ↓ meercop_serial_data = { user_id: "c4a4621e-...", ... }
    ↓
[useAuth] effectiveUserId = serialUserId (c4a4621e-...)
    ↓
[get-devices] user_id: c4a4621e-... → 모든 기기 조회 성공
    ↓
[Presence 구독] user-presence-c4a4621e-... → 랩탑 상태 수신

[랩탑 시리얼 입력]
    ↓ validate-serial (이 프로젝트 DB: sltxwkdvaapyeosikegj)
    ↓ → device_id, user_id 수신
    ↓
[Presence track] user-presence-c4a4621e-... (key: deviceId)
    ↓ → 스마트폰이 랩탑 온라인 상태 감지
```

---

## ⚠️ 체크리스트 요약

| # | 항목 | 확인 방법 |
|---|------|-----------|
| 1 | 시리얼 세션 user_id 비어있지 않은지 | localStorage → meercop_serial_data |
| 2 | effectiveUserId가 c4a4621e-...인지 | 콘솔 로그 `[Auth] effectiveUserId debug:` |
| 3 | get-devices 요청 user_id | 네트워크 탭 → Request Body |
| 4 | 랩탑 validate-serial URL이 맞는지 | 랩탑 앱 코드/로그 |
| 5 | 랩탑 Presence 채널명이 user-presence-${userId}인지 | 랩탑 앱 코드/로그 |
| 6 | 랩탑 Anon Key가 이 프로젝트 키인지 | 랩탑 앱 설정 |
| 7 | 모든 기기 user_id가 동일한지 | DB 조회 |
