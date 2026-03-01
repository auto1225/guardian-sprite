// Shared WebRTC types

export interface WebRTCViewerOptions {
  deviceId: string;
  onError?: (error: string) => void;
}

export interface WebRTCViewerState {
  isConnecting: boolean;
  isConnected: boolean;
  remoteStream: MediaStream | null;
  connect: () => void;
  disconnect: () => Promise<void>;
}

export interface WebRTCBroadcasterOptions {
  deviceId: string;
  onError?: (error: string) => void;
  onViewerConnected?: (viewerId: string) => void;
  onViewerDisconnected?: (viewerId: string) => void;
}

export interface WebRTCBroadcasterState {
  isBroadcasting: boolean;
  localStream: MediaStream | null;
  viewerCount: number;
  startBroadcasting: () => Promise<void>;
  stopBroadcasting: () => Promise<void>;
}
