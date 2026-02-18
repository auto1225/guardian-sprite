// src/lib/channelManager.ts
// §2-4: ChannelManager 싱글톤 — Realtime 채널 중복 구독 방지
// S-13: 네트워크 복구 시 자동 재연결 지원

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

class ChannelManager {
  private channels = new Map<string, RealtimeChannel>();
  private networkListenerAttached = false;

  constructor() {
    this.attachNetworkListener();
  }

  getOrCreate(name: string): RealtimeChannel {
    const existing = this.channels.get(name);
    if (existing) return existing;

    const ch = supabase.channel(name);
    this.channels.set(name, ch);
    return ch;
  }

  get(name: string): RealtimeChannel | undefined {
    return this.channels.get(name);
  }

  remove(name: string): void {
    const ch = this.channels.get(name);
    if (ch) {
      supabase.removeChannel(ch);
      this.channels.delete(name);
    }
  }

  removeAll(): void {
    this.channels.forEach((ch) => supabase.removeChannel(ch));
    this.channels.clear();
  }

  has(name: string): boolean {
    return this.channels.has(name);
  }

  /** S-13: 네트워크 복구 시 모든 채널 재연결 */
  private attachNetworkListener(): void {
    if (this.networkListenerAttached) return;
    if (typeof window === "undefined") return;

    this.networkListenerAttached = true;

    window.addEventListener("online", () => {
      console.log("[ChannelManager] 🌐 Network restored, reconnecting channels...");
      // Supabase SDK는 내부 재연결을 시도하지만,
      // CHANNEL_ERROR 상태로 남은 채널은 수동 재구독이 필요
      this.channels.forEach((ch, name) => {
        const state = (ch as unknown as { state?: string }).state;
        if (state === "errored" || state === "closed") {
          console.log(`[ChannelManager] ♻️ Re-subscribing errored channel: ${name}`);
          supabase.removeChannel(ch);
          const newCh = supabase.channel(name);
          this.channels.set(name, newCh);
          // 새 채널은 구독자가 다시 설정해야 하므로 이벤트로 알림
          window.dispatchEvent(new CustomEvent("channelmanager:reconnect", { detail: { name } }));
        }
      });
    });
  }
}

export const channelManager = new ChannelManager();
