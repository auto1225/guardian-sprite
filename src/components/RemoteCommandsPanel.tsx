import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Lock, MessageSquare, Send, Loader2 } from "lucide-react";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface RemoteCommandsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  device: Device | null;
}

const RemoteCommandsPanel = ({ isOpen, onClose, device }: RemoteCommandsPanelProps) => {
  const { t } = useTranslation();
  const { lockDevice, sendMessage } = useCommands();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [lockLoading, setLockLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);

  if (!isOpen || !device) return null;

  const handleLock = async () => {
    setLockLoading(true);
    try {
      await lockDevice(device.id);
      // Also broadcast for RLS-free laptop reception
      // CRITICAL: Channel name must match what the laptop subscribes to
      const broadcastChannelName = `device-commands-${device.id}`;
      const existingCh = supabase.getChannels().find(ch => ch.topic === `realtime:${broadcastChannelName}`);
      if (existingCh) supabase.removeChannel(existingCh);
      
      const channel = supabase.channel(broadcastChannelName);
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { supabase.removeChannel(channel); resolve(); }, 5000);
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(timeout);
              channel.send({
                type: "broadcast",
                event: "lock_command",
                payload: { device_id: device.id },
              }).then(() => { supabase.removeChannel(channel); resolve(); });
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              resolve(); // DB command already sent, broadcast is best-effort
            }
          });
        });
      } catch { /* broadcast is best-effort */ }
      toast({ title: t("commands.lockSent"), description: t("commands.lockSentDesc") });
    } catch {
      toast({ title: t("common.error"), description: t("commands.lockFailed"), variant: "destructive" });
    } finally {
      setLockLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    setMessageLoading(true);
    try {
      await sendMessage(device.id, message.trim());
      // Also broadcast for RLS-free laptop reception
      const broadcastChannelName = `device-commands-${device.id}`;
      const existingCh = supabase.getChannels().find(ch => ch.topic === `realtime:${broadcastChannelName}`);
      if (existingCh) supabase.removeChannel(existingCh);
      
      const channel = supabase.channel(broadcastChannelName);
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { supabase.removeChannel(channel); resolve(); }, 5000);
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(timeout);
              channel.send({
                type: "broadcast",
                event: "message_command",
                payload: { device_id: device.id, message: message.trim() },
              }).then(() => { supabase.removeChannel(channel); resolve(); });
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              resolve();
            }
          });
        });
      } catch { /* broadcast is best-effort */ }
      toast({ title: t("commands.messageSent"), description: t("commands.messageSentDesc") });
      setMessage("");
    } catch {
      toast({ title: t("common.error"), description: t("commands.messageFailed"), variant: "destructive" });
    } finally {
      setMessageLoading(false);
    }
  };

  const isOffline = device.status === "offline";

  return (
    <div className="fixed inset-0 bg-card z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={onClose} className="text-card-foreground">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <span className="font-bold text-lg">{t("commands.title")}</span>
        </div>
        <div className="w-6" />
      </div>

      {/* Device badge */}
      <div className="flex justify-center py-3">
        <div className="bg-secondary/90 rounded-full px-4 py-1.5">
          <span className="text-secondary-foreground font-bold text-sm">{device.name}</span>
        </div>
      </div>

      {isOffline && (
        <div className="mx-4 mb-3 px-4 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive text-center">{t("commands.deviceOffline")}</p>
        </div>
      )}

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Lock Command */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <h3 className="font-bold text-card-foreground">{t("commands.lockTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("commands.lockDesc")}</p>
            </div>
          </div>
          <button
            onClick={handleLock}
            disabled={lockLoading || isOffline}
            className="w-full py-3 rounded-xl bg-destructive text-destructive-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {lockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {t("commands.lockButton")}
          </button>
        </div>

        {/* Message Command */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-card-foreground">{t("commands.messageTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("commands.messageDesc")}</p>
            </div>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("commands.messagePlaceholder")}
            className="w-full h-24 rounded-xl border border-border bg-muted/50 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            maxLength={500}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{message.length}/500</span>
            <button
              onClick={handleSendMessage}
              disabled={messageLoading || !message.trim() || isOffline}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {messageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {t("commands.sendButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemoteCommandsPanel;
