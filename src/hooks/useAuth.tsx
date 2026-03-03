import { useState, useEffect, useRef, createContext, useContext, ReactNode } from "react";
import { User, Session, RealtimeChannel } from "@supabase/supabase-js";
import { websiteSupabase, fetchUserSerials, UserSerial, ServerCapabilities, PlanCapabilitiesMap } from "@/lib/websiteAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clearCapabilitiesCache } from "@/hooks/usePlanCapabilities";

// Legacy keys (cleanup on logout)
const SERIAL_STORAGE_KEY = "meercop_serial_key";
const SERIAL_DATA_KEY = "meercop_serial_data";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  serials: UserSerial[];
  serialsLoading: boolean;
  capabilities: ServerCapabilities;
  planCapabilities: PlanCapabilitiesMap;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  effectiveUserId: string | null;
  refreshSerials: () => Promise<void>;
  /** @deprecated kept for backward compat */
  serialUserId: string | null;
  /** @deprecated kept for backward compat */
  serialSession: null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [serials, setSerials] = useState<UserSerial[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities>({});
  const [planCapabilities, setPlanCapabilities] = useState<PlanCapabilitiesMap>({});
  const [serialsLoading, setSerialsLoading] = useState(false);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const prevSerialsRef = useRef<UserSerial[]>([]);
  const { toast } = useToast();

  const loadSerials = async (accessToken: string) => {
    setSerialsLoading(true);
    try {
      const result = await fetchUserSerials(accessToken);
      console.log("[Auth] 📦 Server capabilities:", JSON.stringify(result.capabilities, null, 2));
      console.log("[Auth] 📦 Plan capabilities:", JSON.stringify(result.plan_capabilities, null, 2));
      console.log("[Auth] 📋 Serials:", result.serials.map(s => `${s.serial_key} (${s.plan_type}/${s.status})`));
      setSerials(result.serials);
      setCapabilities(result.capabilities);
      setPlanCapabilities(result.plan_capabilities);
    } catch {
      setSerials([]);
      setCapabilities({});
      setPlanCapabilities({});
    } finally {
      setSerialsLoading(false);
    }
  };

  // Detect plan/status changes and show appropriate toasts
  const detectPlanChanges = (oldSerials: UserSerial[], newSerials: UserSerial[]) => {
    for (const newSerial of newSerials) {
      const oldSerial = oldSerials.find((s) => s.id === newSerial.id);
      if (!oldSerial) continue;

      // Status change: expired → active (upgrade detected)
      if (oldSerial.status === "expired" && newSerial.status === "active") {
        const planLabel = newSerial.plan_type === "premium" ? "Premium" : newSerial.plan_type === "basic" ? "Basic" : "Free";
        toast({
          title: "🎉 플랜이 업그레이드되었습니다!",
          description: `${planLabel} 플랜이 활성화되었습니다. 모든 기능을 이용하세요!`,
        });
        console.log("[Auth] ✅ Plan upgraded:", oldSerial.plan_type, "→", newSerial.plan_type, "status:", newSerial.status);
      }

      // Plan type change (while active)
      if (oldSerial.plan_type !== newSerial.plan_type && newSerial.status === "active") {
        const oldLabel = oldSerial.plan_type === "premium" ? "Premium" : oldSerial.plan_type === "basic" ? "Basic" : "Free";
        const newLabel = newSerial.plan_type === "premium" ? "Premium" : newSerial.plan_type === "basic" ? "Basic" : "Free";
        // Only show if not already shown by upgrade toast
        if (oldSerial.status !== "expired") {
          toast({
            title: "📦 플랜이 변경되었습니다",
            description: `${oldLabel} → ${newLabel}`,
          });
          console.log("[Auth] 📦 Plan changed:", oldLabel, "→", newLabel);
        }
      }

      // Status change: active → expired
      if (oldSerial.status === "active" && newSerial.status === "expired") {
        toast({
          title: "⚠️ 플랜이 만료되었습니다",
          description: "웹사이트에서 플랜을 갱신해주세요.",
          variant: "destructive",
        });
        console.log("[Auth] ⚠️ Plan expired for serial:", newSerial.serial_key);
      }
    }
  };

  // Track serial changes
  useEffect(() => {
    if (serials.length > 0 && prevSerialsRef.current.length > 0) {
      detectPlanChanges(prevSerialsRef.current, serials);
    }
    prevSerialsRef.current = serials;
  }, [serials]);

  const subscribeRealtime = (userId: string) => {
    // Cleanup existing
    if (realtimeChannelRef.current) {
      websiteSupabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const channel = websiteSupabase
      .channel("my-serials")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "serial_numbers",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          console.log("[Auth] Realtime serial change:", payload.eventType);
          if (payload.eventType === "INSERT") {
            toast({ title: "🆕 New serial added", description: "A new device license has been added to your account." });
          } else if (payload.eventType === "DELETE") {
            toast({ title: "❌ Serial removed", description: "A device license has been removed." });
          }
          // For all events (INSERT, UPDATE, DELETE) — refresh serials to get latest state
          websiteSupabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s?.access_token) loadSerials(s.access_token);
          });
        }
      )
      .subscribe((status) => {
        console.log("[Auth] Realtime subscription status:", status);
      });

    realtimeChannelRef.current = channel;
  };

  const unsubscribeRealtime = () => {
    if (realtimeChannelRef.current) {
      websiteSupabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  };

  useEffect(() => {
    const { data: { subscription } } = websiteSupabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);

        if (newSession?.access_token && newSession.user) {
          setTimeout(() => loadSerials(newSession.access_token), 0);
          subscribeRealtime(newSession.user.id);
        } else {
          setSerials([]);
          unsubscribeRealtime();
        }
      }
    );

    websiteSupabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      setLoading(false);
      if (existing?.access_token && existing.user) {
        loadSerials(existing.access_token);
        subscribeRealtime(existing.user.id);
      }
    });

    // Reconnect on network restore
    const handleOnline = () => {
      if (user?.id) {
        console.log("[Auth] Network restored, re-subscribing to serials...");
        subscribeRealtime(user.id);
      }
    };
    window.addEventListener("online", handleOnline);

    return () => {
      subscription.unsubscribe();
      unsubscribeRealtime();
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await websiteSupabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (_email: string, _password: string) => {
    return { error: new Error("Signup is only available on the MeerCOP website.") };
  };

  const signOut = async () => {
    // 로그아웃 전에 공유 DB에서 내 기기들 삭제 (fire-and-forget)
    if (effectiveUserId) {
      try {
        const { data: myDevices } = await supabase
          .from("devices")
          .select("id")
          .eq("user_id", effectiveUserId);
        
        if (myDevices?.length) {
          for (const dev of myDevices) {
            supabase.functions.invoke("update-device", {
              body: { device_id: dev.id, _action: "delete" },
            }).catch(err => console.warn("[SignOut] Shared DB delete failed:", err));
          }
          console.log(`[SignOut] ✅ Requested deletion of ${myDevices.length} device(s) from shared DB`);
        }
      } catch (err) {
        console.warn("[SignOut] ⚠️ Shared DB cleanup error:", err);
      }
    }

    localStorage.removeItem(SERIAL_STORAGE_KEY);
    localStorage.removeItem(SERIAL_DATA_KEY);
    clearCapabilitiesCache();
    setSerials([]);
    setCapabilities({});
    setPlanCapabilities({});
    prevSerialsRef.current = [];
    unsubscribeRealtime();
    await websiteSupabase.auth.signOut();
  };

  const refreshSerials = async () => {
    const { data: { session: s } } = await websiteSupabase.auth.getSession();
    if (s?.access_token) {
      await loadSerials(s.access_token);
    }
  };

  const effectiveUserId = user?.id || null;

  useEffect(() => {
    console.log("[Auth] effectiveUserId:", effectiveUserId, "email:", user?.email);
  }, [effectiveUserId, user?.email]);

  return (
    <AuthContext.Provider value={{
      user, session, loading, serials, serialsLoading, capabilities, planCapabilities,
      signIn, signUp, signOut, effectiveUserId, refreshSerials,
      serialUserId: null, serialSession: null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
