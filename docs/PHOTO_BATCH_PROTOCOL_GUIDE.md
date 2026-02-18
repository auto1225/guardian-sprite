# Photo Alert Batch Protocol Guide (v9)

## 개요

하나의 보안 이벤트(카메라 모션, 키보드 입력 등)에서 여러 장의 사진을 전송할 때,
스마트폰이 **모든 사진을 수신 완료한 후 한 번만** 경보 오버레이를 표시하도록
배치(batch) 프로토콜을 사용합니다.

## 이전 문제점

- 컴퓨터가 5장의 사진을 2장씩 나누어 3개의 시퀀스(start→chunks→end)로 전송
- 각 `photo_alert_end`마다 스마트폰에서 경보 오버레이가 새로 생성됨
- 임시 방편으로 30초 억제를 사용했으나, 새로운 진짜 경보도 무시되는 부작용 발생

## 프로토콜 변경사항

### `photo_alert_start` 페이로드

```json
{
  "id": "seq-uuid-1",          // 개별 시퀀스 고유 ID (기존)
  "batch_id": "batch-uuid-1",  // ⭐ NEW: 배치 고유 ID (하나의 이벤트에 대해 동일)
  "batch_total": 3,            // ⭐ NEW: 이 배치의 총 시퀀스 수
  "device_id": "device-uuid",
  "device_name": "내 노트북",
  "event_type": "camera_motion",
  "total_photos": 2,           // 이 시퀀스의 사진 수
  "change_percent": 15.5,
  "created_at": "2024-01-01T00:00:00Z"
}
```

### 하위 호환성

- `batch_id`가 없으면 `id`를 `batch_id`로 사용
- `batch_total`이 없으면 `1`로 간주 (단일 시퀀스 = 단일 배치)
- 기존 컴퓨터 앱은 수정 없이도 동작하지만, 여러 시퀀스 전송 시 각각 별도 경보로 표시됨

## 컴퓨터 앱 구현 가이드

### 사진 전송 흐름

```
이벤트 감지
  ├─ batch_id 생성 (UUID)
  ├─ 사진 5장 촬영
  ├─ 2장씩 분할 → 3개 시퀀스
  │
  ├─ 시퀀스 1: start(batch_id, batch_total=3) → chunk → end
  ├─ 시퀀스 2: start(batch_id, batch_total=3) → chunk → end
  └─ 시퀀스 3: start(batch_id, batch_total=3) → chunk → end
                                                      ↓
                                          스마트폰: 여기서 오버레이 1회 표시
```

### 코드 예시 (Electron/노트북 앱)

```typescript
import { v4 as uuidv4 } from 'uuid';

async function sendPhotoAlert(photos: string[], eventType: string, deviceId: string) {
  const PHOTOS_PER_SEQUENCE = 2;
  const sequences = [];
  
  // 사진을 시퀀스별로 분할
  for (let i = 0; i < photos.length; i += PHOTOS_PER_SEQUENCE) {
    sequences.push(photos.slice(i, i + PHOTOS_PER_SEQUENCE));
  }

  // ⭐ 하나의 이벤트에 대해 동일한 batch_id 사용
  const batchId = uuidv4();
  const batchTotal = sequences.length;

  for (let seqIndex = 0; seqIndex < sequences.length; seqIndex++) {
    const seqPhotos = sequences[seqIndex];
    const seqId = uuidv4();

    // 1. photo_alert_start
    await channel.send({
      type: 'broadcast',
      event: 'photo_alert_start',
      payload: {
        id: seqId,
        batch_id: batchId,        // ⭐ 배치 ID
        batch_total: batchTotal,   // ⭐ 총 시퀀스 수
        device_id: deviceId,
        event_type: eventType,
        total_photos: seqPhotos.length,
        created_at: new Date().toISOString(),
      }
    });

    // 2. photo_alert_chunk (2장씩 chunk)
    const CHUNK_SIZE = 2;
    const totalChunks = Math.ceil(seqPhotos.length / CHUNK_SIZE);
    for (let ci = 0; ci < seqPhotos.length; ci += CHUNK_SIZE) {
      await channel.send({
        type: 'broadcast',
        event: 'photo_alert_chunk',
        payload: {
          id: seqId,
          chunk_index: Math.floor(ci / CHUNK_SIZE),
          total_chunks: totalChunks,
          photos: seqPhotos.slice(ci, ci + CHUNK_SIZE),
        }
      });
      await sleep(300); // 네트워크 혼잡 방지
    }

    // 3. photo_alert_end
    await channel.send({
      type: 'broadcast',
      event: 'photo_alert_end',
      payload: {
        id: seqId,
        total_photos: seqPhotos.length,
        latitude: currentLocation?.lat,
        longitude: currentLocation?.lng,
      }
    });

    await sleep(300); // 시퀀스 간 간격
  }
}
```

## 스마트폰 수신 처리 (자동)

스마트폰의 `usePhotoReceiver` 훅이 자동으로:

1. `photo_alert_start` → 배치 생성 또는 기존 배치에 시퀀스 추가
2. `photo_alert_chunk` → 해당 시퀀스에 사진 누적, 전체 진행률 계산
3. `photo_alert_end` → 시퀀스 완료 마킹
4. **모든 시퀀스 완료 시** → 사진 병합 후 오버레이 **1회** 표시

## 중요 규칙

- `batch_id`는 **하나의 감지 이벤트**에 대해 반드시 동일해야 함
- `batch_total`은 첫 시퀀스에서 정확히 알아야 함 (사진 분할 후 전송 시작)
- 시퀀스 간 300ms 간격 유지 (기존 프로토콜과 동일)
