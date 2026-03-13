/**
 * Native App ↔ WebView JS Bridge
 *
 * 네이티브 앱(Android/iOS)과 WebView 간 양방향 통신 인터페이스.
 *
 * ── Web → Native (네이티브 앱이 구현해야 할 인터페이스) ──
 *   window.NativeApp.onLoginSuccess(accessToken, refreshToken)
 *   window.NativeApp.onLogout()
 *   window.NativeApp.onSessionRestored()
 *
 * ── Native → Web (웹이 구현하는 인터페이스) ──
 *   window.onNativeToken(accessToken, refreshToken)  → 토큰으로 세션 복원
 *   window.onFCMToken(fcmToken)                       → FCM 토큰 수신 및 서버 저장
 *   window.onPushReceived(payload)                    → 푸시 수신 시 앱 내 처리
 *   window.isNativeApp()                              → 네이티브 앱 여부 확인
 */

// ── 타입 정의 ──

export interface NativeAppInterface {
  onLoginSuccess: (accessToken: string, refreshToken: string) => void;
  onLogout: () => void;
  onSessionRestored: () => void;
}

export interface NativeWebInterface {
  onNativeToken: (accessToken: string, refreshToken: string) => void;
  onFCMToken: (fcmToken: string) => void;
  onPushReceived: (payload: Record<string, unknown>) => void;
  isNativeApp: () => boolean;
}

// Window 타입 확장
declare global {
  interface Window {
    NativeApp?: NativeAppInterface;
    onNativeToken?: (accessToken: string, refreshToken: string) => void;
    onFCMToken?: (fcmToken: string) => void;
    onPushReceived?: (payload: Record<string, unknown>) => void;
    isNativeApp?: () => boolean;
    __NATIVE_FCM_TOKEN?: string;
    __IS_NATIVE_APP?: boolean;
  }
}

// ── 네이티브 환경 감지 ──

export function isRunningInNativeApp(): boolean {
  try {
    if (window.__IS_NATIVE_APP) return true;
    if (window.NativeApp) return true;
    if (typeof window.isNativeApp === "function" && window.isNativeApp()) return true;
  } catch {
    // ignore bridge probing errors and continue with UA fallback
  }

  const ua = navigator.userAgent || "";
  const isAndroidWebView = /\bwv\b/i.test(ua) || /Android.*Version\/[\d.]+/i.test(ua);
  const isIOSWebView = /iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua);

  return isAndroidWebView || isIOSWebView;
}

// ── Web → Native 호출 ──

export function notifyNativeLoginSuccess(accessToken: string, refreshToken: string): void {
  if (window.NativeApp?.onLoginSuccess) {
    try {
      window.NativeApp.onLoginSuccess(accessToken, refreshToken);
      console.log("[NativeBridge] → Native: onLoginSuccess");
    } catch (err) {
      console.warn("[NativeBridge] Native onLoginSuccess error:", err);
    }
  }
}

export function notifyNativeLogout(): void {
  if (window.NativeApp?.onLogout) {
    try {
      window.NativeApp.onLogout();
      console.log("[NativeBridge] → Native: onLogout");
    } catch (err) {
      console.warn("[NativeBridge] Native onLogout error:", err);
    }
  }
}

export function notifyNativeSessionRestored(): void {
  if (window.NativeApp?.onSessionRestored) {
    try {
      window.NativeApp.onSessionRestored();
      console.log("[NativeBridge] → Native: onSessionRestored");
    } catch (err) {
      console.warn("[NativeBridge] Native onSessionRestored error:", err);
    }
  }
}

// ── FCM 토큰 관련 ──

export function getPendingFCMToken(): string | null {
  return window.__NATIVE_FCM_TOKEN || null;
}

export function clearPendingFCMToken(): void {
  delete window.__NATIVE_FCM_TOKEN;
}
