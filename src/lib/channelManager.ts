// src/lib/channelManager.ts
// §2-4: ChannelManager 싱글톤 — Realtime 채널 중복 구독 방지

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

class ChannelManager {
  private channels = new Map<string, RealtimeChannel>();

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
}

export const channelManager = new ChannelManager();
