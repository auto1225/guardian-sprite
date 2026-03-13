import { useState, useEffect, useRef, createContext, useContext, ReactNode } from "react";
import { User, Session, RealtimeChannel } from "@supabase/supabase-js";
import { websiteSupabase, fetchUserSerials, UserSerial, ServerCapabilities, PlanCapabilitiesMap } from "@/lib/websiteAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clearCapabilitiesCache } from "@/hooks/usePlanCapabilities";
import { notifyNativeLoginSuccess, notifyNativeLogout } from "@/lib/nativeBridge";
import { safeStorage } from "@/lib/safeStorage";

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
  const initialSessionHydratedRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
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

  const planFeaturesChannelRef = useRef<RealtimeChannel | null>(null);

  const subscribeRealtime = (userId: string) => {
    // Cleanup existing
    if (realtimeChannelRef.current) {
      websiteSupabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    if (planFeaturesChannelRef.current) {
      websiteSupabase.removeChannel(planFeaturesChannelRef.current);
      planFeaturesChannelRef.current = null;
    }

    // 1) serial_numbers 변경 구독
    const serialChannel = websiteSupabase
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
          websiteSupabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s?.access_token) loadSerials(s.access_token);
          });
        }
      )
      .subscribe((status) => {
        console.log("[Auth] Realtime serial subscription:", status);
      });

    realtimeChannelRef.current = serialChannel;

    // 2) plan_features 변경 구독 — Broadcast 방식 (CMS에서 이벤트 전송)
    const planChannel = websiteSupabase
      .channel("plan-features-broadcast")
      .on(
        "broadcast",
        { event: "capabilities_updated" },
        (payload) => {
          console.log("[Auth] 🔄 Broadcast: capabilities_updated", payload);
          toast({ title: "⚙️ 기능 설정이 업데이트되었습니다", description: "최신 플랜 권한이 적용됩니다." });
          websiteSupabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s?.access_token) loadSerials(s.access_token);
          });
        }
      )
      .subscribe((status) => {
        console.log("[Auth] Broadcast plan-features subscription:", status);
      });

    planFeaturesChannelRef.current = planChannel;
  };

  const unsubscribeRealtime = () => {
    if (realtimeChannelRef.current) {
      websiteSupabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    if (planFeaturesChannelRef.current) {
      websiteSupabase.removeChannel(planFeaturesChannelRef.current);
      planFeaturesChannelRef.current = null;
    }
  };

  useEffect(() => {
    let mounted = true;

    const applySessionState = (nextSession: Session | null, deferSerialLoad: boolean) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.access_token && nextSession.user) {
        if (deferSerialLoad) {
          setTimeout(() => loadSerials(nextSession.access_token), 0);
        } else {
          loadSerials(nextSession.access_token);
        }
        subscribeRealtime(nextSession.user.id);
      } else {
        setSerials([]);
        unsubscribeRealtime();
      }
    };

    const { data: { subscription } } = websiteSupabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!initialSessionHydratedRef.current && event === "INITIAL_SESSION") {
          return;
        }

        applySessionState(newSession, true);
        setLoading(false);
      }
    );

    websiteSupabase.auth.getSession().then(({ data: { session: existing } }) => {
      if (!mounted) return;

      initialSessionHydratedRef.current = true;
      applySessionState(existing, false);
      setLoading(false);
    });

    // Reconnect on network restore
    const handleOnline = () => {
      const currentUserId = currentUserIdRef.current;
      if (currentUserId) {
        console.log("[Auth] Network restored, re-subscribing to serials...");
        subscribeRealtime(currentUserId);
      }
    };
    window.addEventListener("online", handleOnline);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      unsubscribeRealtime();
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await websiteSupabase.auth.signInWithPassword({ email, password });

    if (!error && data.session) {
      // WebView 환경에서 onAuthStateChange 이벤트가 지연되거나 누락돼도 즉시 상태 반영
      setSession(data.session);
      setUser(data.session.user ?? null);
      setLoading(false);
      setTimeout(() => loadSerials(data.session!.access_token), 0);
      subscribeRealtime(data.session.user.id);

      notifyNativeLoginSuccess(data.session.access_token, data.session.refresh_token);
    }

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

    safeStorage.removeItem(SERIAL_STORAGE_KEY);
    safeStorage.removeItem(SERIAL_DATA_KEY);
    clearCapabilitiesCache();
    setSerials([]);
    setCapabilities({});
    setPlanCapabilities({});
    prevSerialsRef.current = [];
    unsubscribeRealtime();
    notifyNativeLogout();
    await websiteSupabase.auth.signOut();
  };

  const refreshSerials = async () => {
    const { data: { session: s } } = await websiteSupabase.auth.getSession();
    if (s?.access_token) {
      await loadSerials(s.access_token);
    }
  };

  const effectiveUserId = user?.id || session?.user?.id || null;

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
