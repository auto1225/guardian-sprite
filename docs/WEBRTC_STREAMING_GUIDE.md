# WebRTC 실시간 카메라 스트리밍 가이드

MeerCOP 시스템의 WebRTC 기반 실시간 카메라 스트리밍 구현 가이드입니다.

> ⚠️ **채널 아키텍처 참고**: WebRTC 시그널링은 `webrtc_signaling` 테이블을 통해 수행되며, Presence/Alert 채널 변경과는 독립적입니다.

## 🚨 중요: 영상이 안 보이는 경우

**영상이 보이지 않는다면, 노트북 앱에 AutoBroadcaster 컴포넌트가 구현되어 있는지 확인하세요!**

스마트폰 앱만으로는 영상을 볼 수 없습니다. **노트북 앱이 반드시 실행 중이어야 하며**, 아래의 AutoBroadcaster 코드가 노트북 앱에 추가되어 있어야 합니다.

---

## 아키텍처 개요

```
┌─────────────────┐     Supabase Realtime     ┌─────────────────┐
│   노트북 앱      │ ◄──── Signaling ────────► │   스마트폰 앱    │
│  (Broadcaster)  │                           │    (Viewer)     │
└────────┬────────┘                           └────────┬────────┘
         │                                             │
         │              WebRTC P2P                     │
         └─────────── Video Stream ───────────────────►│
```

### 동작 흐름

1. **[스마트폰]** "카메라 보기" 클릭 → `devices.is_streaming_requested = true`
2. **[노트북]** `is_streaming_requested` 변경 감지 → 카메라 시작
3. **[스마트폰]** `viewer-join` 이벤트 전송
4. **[노트북]** offer 생성 및 전송
5. **[스마트폰]** answer 전송
6. **[양쪽]** ICE candidate 교환
7. **[스마트폰]** 비디오 스트림 수신 → 화면에 표시

### 성능 권장 사항

- 송출 해상도: **640x480 (VGA)** — 모바일 GPU 부하 및 WebGL 컨텍스트 유실 방지
- 프레임레이트: **15~30fps**
- 새 뷰어 연결 시 I-Frame 강제 생성: 비디오 트랙 `enabled`를 1초간 토글 또는 `frameRate` 미세 조정 (29↔30)

---

## 🔴 노트북 앱 (Broadcaster) - 필수 구현!

### AutoBroadcaster 컴포넌트

이 컴포넌트를 **노트북 앱의 최상위**에 추가하세요.

```tsx
// src/components/AutoBroadcaster.tsx
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWebRTCBroadcaster } from "@/hooks/useWebRTCBroadcaster";

interface AutoBroadcasterProps {
  deviceId: string;
}

export const AutoBroadcaster = ({ deviceId }: AutoBroadcasterProps) => {
  const { isBroadcasting, startBroadcasting, stopBroadcasting } =
    useWebRTCBroadcaster({ deviceId });

  useEffect(() => {
    const checkInitialState = async () => {
      const { data } = await supabase
        .from("devices")
        .select("is_streaming_requested")
        .eq("id", deviceId)
        .single();
      
      if (data?.is_streaming_requested && !isBroadcasting) {
        startBroadcasting();
      }
    };
    checkInitialState();

    const channel = supabase
      .channel(`device-streaming-${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${deviceId}`,
        },
        (payload) => {
          const { is_streaming_requested } = payload.new as {
            is_streaming_requested: boolean;
          };

          if (is_streaming_requested && !isBroadcasting) {
            startBroadcasting();
          } else if (!is_streaming_requested && isBroadcasting) {
            stopBroadcasting();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, isBroadcasting, startBroadcasting, stopBroadcasting]);

  return null;
};
```

### 카메라 재연결 주의사항

- 카메라 재연결 시 기존 `PeerConnection`을 **완전히 닫고** `broadcaster-ready` 신호를 전송
- 이전 세션의 잔여 `viewer-join` 방지를 위해 첫 폴링 전 **3~4초 유예 기간** 적용
- 비디오 트랙이 stale(muted/disabled)인 경우에만 `broadcast-needs-restart` 이벤트 발생

---

## 스마트폰 앱 (Viewer) - 이미 구현됨

### 핵심 파일

- `src/hooks/useWebRTCViewer.tsx` - WebRTC Viewer 훅
- `src/pages/Camera.tsx` - 카메라 페이지 UI
- `src/components/camera/CameraViewer.tsx` - 비디오 뷰어 컴포넌트

---

## 시그널링 프로토콜

### 메시지 타입

| 이벤트         | 방향              | 설명                    |
| -------------- | ----------------- | ----------------------- |
| `viewer-join`  | Viewer → 채널     | 시청자가 연결 요청      |
| `broadcaster-ready` | Broadcaster → 채널 | 방송 준비 완료 |
| `offer`        | Broadcaster → Viewer | SDP offer 전송       |
| `answer`       | Viewer → Broadcaster | SDP answer 전송      |
| `ice-candidate`| 양방향           | ICE candidate 교환      |

### 레이스 컨디션 방지

- **뷰어**: `isProcessingOfferRef` 동기 가드로 오퍼 처리 원자화
- **뷰어**: `broadcaster-ready` 수신 시 5초 이내 또는 이미 오퍼 받은 경우 무시 (데바운스)
- **뷰어**: 연결 성공 직후 5초간 재연결 차단 (`connectionSucceededAtRef`)
- **브로드캐스터**: 트리플 락(Triple Lock)으로 중복 오퍼 발송 차단
- **브로드캐스터**: 재시작 시 기존 세션 ID 유지하여 무한 루프 방지
- **양쪽**: 트랙 수신 시 `unmute` 이벤트 대기 + 150ms 데바운스로 최종 스트림 확정

---

## 데이터베이스 스키마

### devices 테이블

| 컬럼                    | 타입    | 설명                           |
| ----------------------- | ------- | ------------------------------ |
| `is_streaming_requested`| boolean | 스마트폰이 스트리밍 요청 시 true |

---

## 문제 해결

### 연결이 안 될 때

1. **STUN 서버 확인**: 방화벽에서 STUN 포트(3478, 19302)가 열려있는지 확인
2. **NAT 타입 확인**: Symmetric NAT 환경에서는 TURN 서버가 필요할 수 있음
3. **ICE candidate 교환 확인**: 콘솔에서 ICE candidate가 교환되는지 확인

### 영상이 끊길 때

1. **네트워크 대역폭 확인**: 최소 1Mbps 이상 권장
2. **해상도 조정**: 640x480(VGA) 권장
3. **프레임레이트 조정**: 15~30fps 권장

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15 },
  },
});
```
