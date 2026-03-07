# 📛 MeerCOP `licenses.device_name` SSOT 변경 가이드

> **최종 업데이트**: 2026-03-07

## 🔑 핵심 변경 사항

**`licenses.device_name`이 시리얼↔기기명 매핑의 유일한 진실의 원천(SSOT)이 되었습니다.**

### 변경 전 (문제점)
- `devices.name`이 기기명의 정본이었음
- 시리얼이 다른 `device_id`에 연결되면 이름이 뒤섞이는 문제 발생
- `device_id`(UUID) 기반 매칭이 DB 간 불일치를 유발

### 변경 후
- `licenses.device_name` = **시리얼↔기기명 1:1 매핑의 SSOT**
- `devices.name`은 `licenses.device_name`에서 **동기화**되는 사본
- 시리얼 키가 어떤 `device_id`에 연결되든 기기명은 항상 정확

---

## 📊 데이터 흐름

```
시리얼 키 ←→ licenses.device_name (SSOT)
                    ↓ 동기화
              devices.name (사본)
```

### 기기 등록/재접속 시 (`register-device`)
1. `licenses` 테이블에서 해당 시리얼의 `device_name` 조회
2. `licenses.device_name`이 있으면 → `devices.name`에 동기화
3. 없으면 → 요청의 `device_name` 또는 기본값 사용
4. `device_type` 불일치 시 → 요청의 `device_type`으로 자동 보정
5. `licenses` upsert 시 `device_name` 포함

### 기기명 변경 시 (`update-device`)
1. `devices.name` 업데이트
2. 해당 기기의 `metadata.serial_key`로 `licenses.device_name`도 동기화

---

## 🖥️ 노트북 앱 변경 사항

### 1. `register-device` 응답 처리 (필수)

응답에 `device_name` 필드가 포함됩니다. **이 값을 로컬 DB에 반영해야 합니다.**

```typescript
// register-device 호출 후
const { data } = await supabase.functions.invoke("register-device", {
  body: {
    user_id: userId,
    device_name: localDeviceName,
    device_type: "laptop",
    serial_key: serialKey,
  },
});

if (data?.success) {
  const sharedDeviceId = data.device_id;
  const authoritativeName = data.device_name; // ★ SSOT 이름
  
  // ★ 로컬 DB에 SSOT 이름 반영
  if (authoritativeName && authoritativeName !== localDeviceName) {
    await localDb.updateDeviceName(localDeviceId, authoritativeName);
    console.log(`[register] Name synced from SSOT: "${localDeviceName}" → "${authoritativeName}"`);
  }
}
```

### 2. 기기명 변경 시 (기존 로직 유지)

노트북에서 기기명을 변경할 때 `update-device`를 호출하면, Edge Function이 자동으로 `licenses.device_name`도 갱신합니다. **추가 작업 불필요.**

```typescript
// 기존 코드 그대로 사용
await supabase.functions.invoke("update-device", {
  body: { device_id: sharedDeviceId, name: newName },
});
// → update-device가 자동으로 licenses.device_name도 갱신
```

### 3. 하트비트 주의사항

하트비트에서 `name`을 포함하여 전송하는 경우, **공유 DB의 이름을 임의로 덮어쓰지 않도록** 주의하세요.

- ✅ 하트비트에 `name`을 포함하지 않거나
- ✅ `register-device` 응답의 `device_name`을 사용

---

## 🌐 웹사이트 변경 사항

### `verify-serial` 응답의 `device_name` 동기화

현재 `verify-serial`의 `get_user_serials` 응답은 웹사이트 DB의 `serial_numbers.device_name`을 반환합니다.

**동기화 옵션 (택 1):**

#### 옵션 A: 공유 DB → 웹사이트 DB 동기화 (권장)
노트북에서 기기명 변경 시:
1. 공유 DB `update-device` → `licenses.device_name` 갱신 (자동)
2. 웹사이트 DB `serial_numbers.device_name`도 갱신 필요

```typescript
// 노트북 앱에서 기기명 변경 후 웹사이트 DB도 업데이트
await websiteSupabase.from("serial_numbers")
  .update({ device_name: newName })
  .eq("serial_key", serialKey);
```

#### 옵션 B: `verify-serial`에서 공유 DB 조회
`verify-serial` Edge Function이 공유 DB의 `licenses.device_name`을 조회하여 반환.

---

## 📋 체크리스트

### 스마트폰 앱 ✅
- [x] `licenses` 테이블에 `device_name` 컬럼 추가
- [x] `register-device`: `licenses.device_name` SSOT 동기화 + `device_type` 불일치 보정
- [x] `update-device`: 기기명 변경 시 `licenses.device_name` 갱신
- [x] `validate-serial`: `device_type` 기본값 `laptop`으로 변경
- [x] `Settings.tsx`: licenses 조회에 `device_name` 포함
- [x] `DeviceManage.tsx`: licenses 조회에 `device_name` 포함
- [x] `NetworkInfoModal`: forwardRef 경고 수정
- [x] DB 데이터 보정: 잘못된 `device_type` 6건 `laptop`으로 수정

### 노트북 앱
- [ ] `register-device` 응답의 `device_name`을 로컬 DB에 반영
- [ ] 하트비트에서 `name` 필드 전송 금지 또는 SSOT 이름만 사용
- [ ] `validate-serial` 호출 시 `device_type` 파라미터 포함 (기본값 `laptop`)
- [ ] 기기명 변경 시 `update-device` 호출 후 웹사이트 DB 동기화는 불필요 (서버가 처리)

### 웹사이트 ✅ (수정 불필요)
- [x] `verify-serial` 5개 액션 모두 `serial_numbers.device_name`을 SSOT로 처리
- [x] CMS 화면(CMSSerials, CMSUsers) 정확히 표시
- [x] 별도 동기화 불필요 — 웹사이트 DB가 자체 SSOT 유지
