# WebRTC 실시간 카메라 스트리밍 가이드

MeerCOP 시스템의 WebRTC 기반 실시간 카메라 스트리밍 구현 가이드입니다.

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

---

## 🔴 노트북 앱 (Broadcaster) - 필수 구현!

### AutoBroadcaster 컴포넌트

이 컴포넌트를 **노트북 앱의 최상위**에 추가하세요. 이 컴포넌트가 없으면 스마트폰에서 영상을 볼 수 없습니다!

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
    // 초기 상태 확인
    const checkInitialState = async () => {
      const { data } = await supabase
        .from("devices")
        .select("is_streaming_requested")
        .eq("id", deviceId)
        .single();
      
      if (data?.is_streaming_requested && !isBroadcasting) {
        console.log("Initial state: streaming requested, starting...");
        startBroadcasting();
      }
    };
    checkInitialState();

    // 실시간으로 is_streaming_requested 변경 감지
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
          
          console.log("Streaming request changed:", is_streaming_requested);

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

  // 백그라운드에서 작동하므로 UI 없음
  return null;
};
```

### 노트북 앱에서 사용

```tsx
// App.tsx
import { AutoBroadcaster } from "./components/AutoBroadcaster";

function App() {
  const deviceId = "your-registered-device-id";

  return (
    <div>
      {/* 다른 UI 컴포넌트들 */}
      
      {/* 🔴 이 컴포넌트가 반드시 있어야 함! */}
      <AutoBroadcaster deviceId={deviceId} />
    </div>
  );
}
```

---

## 스마트폰 앱 (Viewer) - 이미 구현됨

이 프로젝트에 이미 구현되어 있습니다.

### 핵심 파일

- `src/hooks/useWebRTCViewer.tsx` - WebRTC Viewer 훅
- `src/pages/Camera.tsx` - 카메라 페이지 UI
- `src/components/camera/CameraViewer.tsx` - 비디오 뷰어 컴포넌트

### 사용 방법

```tsx
import { useWebRTCViewer } from "@/hooks/useWebRTCViewer";

const CameraView = ({ deviceId }: { deviceId: string }) => {
  const { isConnecting, isConnected, remoteStream, connect, disconnect } =
    useWebRTCViewer({
      deviceId,
      onError: (error) => console.error(error),
    });

  return (
    <div>
      <video
        ref={(video) => {
          if (video && remoteStream) video.srcObject = remoteStream;
        }}
        autoPlay
        playsInline
        muted
      />
      <button onClick={connect}>연결</button>
      <button onClick={disconnect}>연결 해제</button>
    </div>
  );
};
```

---

## 노트북 앱 (Broadcaster)

### React 웹 앱 구현

이 프로젝트의 `src/hooks/useWebRTCBroadcaster.ts`를 참고하세요.

```tsx
import { useWebRTCBroadcaster } from "@/hooks/useWebRTCBroadcaster";

const CameraBroadcaster = ({ deviceId }: { deviceId: string }) => {
  const {
    isBroadcasting,
    localStream,
    viewerCount,
    startBroadcasting,
    stopBroadcasting,
  } = useWebRTCBroadcaster({
    deviceId,
    onError: (error) => console.error(error),
    onViewerConnected: (viewerId) => console.log("Viewer connected:", viewerId),
    onViewerDisconnected: (viewerId) => console.log("Viewer left:", viewerId),
  });

  return (
    <div>
      <video
        ref={(video) => {
          if (video && localStream) video.srcObject = localStream;
        }}
        autoPlay
        playsInline
        muted
      />
      <p>시청자 수: {viewerCount}</p>
      {!isBroadcasting ? (
        <button onClick={startBroadcasting}>방송 시작</button>
      ) : (
        <button onClick={stopBroadcasting}>방송 중지</button>
      )}
    </div>
  );
};
```

### 자동 스트리밍 시작 (is_streaming_requested 감지)

노트북 앱은 `devices.is_streaming_requested` 필드를 감시하여 자동으로 스트리밍을 시작해야 합니다:

```tsx
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWebRTCBroadcaster } from "@/hooks/useWebRTCBroadcaster";

const AutoBroadcaster = ({ deviceId }: { deviceId: string }) => {
  const { isBroadcasting, startBroadcasting, stopBroadcasting } =
    useWebRTCBroadcaster({ deviceId });

  useEffect(() => {
    // 실시간으로 is_streaming_requested 변경 감지
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

  return null; // 또는 상태 표시 UI
};
```

---

## React Native 앱 (스마트폰/노트북)

React Native에서는 `react-native-webrtc` 라이브러리를 사용합니다.

### 설치

```bash
npm install react-native-webrtc @supabase/supabase-js
```

### Viewer 구현 (React Native)

```tsx
import React, { useState, useRef, useCallback, useEffect } from "react";
import { View, Button } from "react-native";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
} from "react-native-webrtc";
import { supabase } from "./supabase"; // 본인의 supabase client

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export const WebRTCViewer = ({ deviceId }: { deviceId: string }) => {
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);
  const viewerId = useRef(`viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const connect = useCallback(async () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const track = event.track;
      const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([track]);

      // 디바운스 처리: AbortError 방지 (150ms)
      const updateStream = () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          setRemoteStream(stream);
          setIsConnected(true);
        }, 150);
      };

      if (track.muted) {
        // muted 상태라면 데이터가 올 때까지 대기
        const onUnmute = () => {
          track.removeEventListener("unmute", onUnmute);
          updateStream();
        };
        track.addEventListener("unmute", onUnmute);
      } else {
        updateStream();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        supabase.from("webrtc_signaling").insert([{
          device_id: deviceId,
          session_id: viewerId.current,
          type: "ice-candidate",
          sender_type: "viewer",
          data: { candidate: event.candidate.toJSON() }
        }]);
      }
    };

    // Supabase 시그널링 테이블 구독
    const channel = supabase
      .channel(`signaling-${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "webrtc_signaling",
          filter: `device_id=eq.${deviceId}`,
        },
        async (payload) => {
          const record = payload.new;
          if (record.sender_type !== "broadcaster") return;

          if (record.type === "offer" && record.data.target_session === viewerId.current) {
            await pc.setRemoteDescription(new RTCSessionDescription(record.data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await supabase.from("webrtc_signaling").insert([{
              device_id: deviceId,
              session_id: viewerId.current,
              type: "answer",
              sender_type: "viewer",
              data: { sdp: answer.sdp, target_session: viewerId.current }
            }]);
          } else if (record.type === "ice-candidate" && record.data.target_session === viewerId.current) {
            await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
          }
        }
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          // 노트북에게 연결 요청 (테이블 삽입)
          await supabase.from("webrtc_signaling").insert([{
            device_id: deviceId,
            session_id: viewerId.current,
            type: "viewer-join",
            sender_type: "viewer",
            data: { viewerId: viewerId.current }
          }]);
        }
      });
  }, [deviceId]);

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setRemoteStream(null);
    setIsConnected(false);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {remoteStream && (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={{ flex: 1 }}
          objectFit="contain"
        />
      )}
      <Button title={isConnected ? "연결 해제" : "연결"} onPress={isConnected ? disconnect : connect} />
    </View>
  );
};
```

---

## Electron 앱 (노트북)

Electron 앱에서는 일반 브라우저 WebRTC API를 사용할 수 있습니다.

```javascript
// main.js 또는 renderer.js
const { useWebRTCBroadcaster } = require("./hooks/useWebRTCBroadcaster");

// React 컴포넌트에서 사용
const broadcaster = useWebRTCBroadcaster({
  deviceId: "laptop-device-id",
  onError: console.error,
});
```

---

## 시그널링 프로토콜

### 메시지 타입

| 이벤트         | 방향              | 설명                    |
| -------------- | ----------------- | ----------------------- |
| `viewer-join`  | Viewer → 채널     | 시청자가 연결 요청      |
| `offer`        | Broadcaster → Viewer | SDP offer 전송       |
| `answer`       | Viewer → Broadcaster | SDP answer 전송      |
| `ice-candidate`| 양방향           | ICE candidate 교환      |

### 메시지 형식

```typescript
interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  from: string; // 발신자 ID
  to: string; // 수신자 ID 또는 "all"
}
```

---

## 데이터베이스 스키마

### devices 테이블

| 컬럼                    | 타입    | 설명                           |
| ----------------------- | ------- | ------------------------------ |
| `is_streaming_requested`| boolean | 스마트폰이 스트리밍 요청 시 true |

스마트폰 앱이 `is_streaming_requested = true`로 설정하면, 노트북 앱이 이를 감지하여 자동으로 카메라 스트리밍을 시작합니다.

---

## 문제 해결

### 연결이 안 될 때

1. **STUN 서버 확인**: 방화벽에서 STUN 포트(3478, 19302)가 열려있는지 확인
2. **NAT 타입 확인**: Symmetric NAT 환경에서는 TURN 서버가 필요할 수 있음
3. **ICE candidate 교환 확인**: 콘솔에서 ICE candidate가 교환되는지 확인

### 영상이 끊길 때

1. **네트워크 대역폭 확인**: 최소 1Mbps 이상 권장
2. **해상도 조정**: 720p에서 480p로 낮추기
3. **프레임레이트 조정**: 30fps에서 15fps로 낮추기

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15 },
  },
});
```
