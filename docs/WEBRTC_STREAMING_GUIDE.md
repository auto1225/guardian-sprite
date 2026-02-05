# WebRTC 실시간 카메라 스트리밍 가이드

MeerCOP 시스템의 WebRTC 기반 실시간 카메라 스트리밍 구현 가이드입니다.

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

## 스마트폰 앱 (Viewer) - React Web

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

    pc.ontrack = (event: any) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        setIsConnected(true);
      }
    };

    pc.onicecandidate = (event: any) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "signaling",
          payload: {
            type: "ice-candidate",
            payload: event.candidate.toJSON(),
            from: viewerId.current,
            to: deviceId,
          },
        });
      }
    };

    // Supabase 시그널링 채널 구독
    const channel = supabase.channel(`webrtc-${deviceId}`);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "signaling" }, async ({ payload }: any) => {
        if (payload.to !== viewerId.current && payload.to !== "all") return;

        if (payload.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          channel.send({
            type: "broadcast",
            event: "signaling",
            payload: {
              type: "answer",
              payload: answer,
              from: viewerId.current,
              to: payload.from,
            },
          });
        } else if (payload.type === "ice-candidate") {
          await pc.addIceCandidate(new RTCIceCandidate(payload.payload));
        }
      })
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          // 노트북에게 연결 요청
          await channel.send({
            type: "broadcast",
            event: "viewer-join",
            payload: { viewerId: viewerId.current },
          });
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
