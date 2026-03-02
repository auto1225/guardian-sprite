import { useState, useEffect, useRef, createContext, useContext, ReactNode } from "react";
import { User, Session, RealtimeChannel } from "@supabase/supabase-js";
import { websiteSupabase, fetchUserSerials, UserSerial } from "@/lib/websiteAuth";
import { useToast } from "@/hooks/use-toast";

// Legacy keys (cleanup on logout)
const SERIAL_STORAGE_KEY = "meercop_serial_key";
const SERIAL_DATA_KEY = "meercop_serial_data";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  serials: UserSerial[];
  serialsLoading: boolean;
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
  const [serialsLoading, setSerialsLoading] = useState(false);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const { toast } = useToast();

  const loadSerials = async (accessToken: string) => {
    setSerialsLoading(true);
    try {
      const data = await fetchUserSerials(accessToken);
      setSerials(data);
    } catch {
      setSerials([]);
    } finally {
      setSerialsLoading(false);
    }
  };

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
          } else if (payload.eventType === "UPDATE") {
            const newData = payload.new as Record<string, unknown>;
            if (newData.device_name) {
              toast({ title: "📱 Device connected", description: `${newData.device_name} has been linked.` });
            }
          } else if (payload.eventType === "DELETE") {
            toast({ title: "❌ Serial removed", description: "A device license has been removed." });
          }
          // Refresh serials list
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
    localStorage.removeItem(SERIAL_STORAGE_KEY);
    localStorage.removeItem(SERIAL_DATA_KEY);
    setSerials([]);
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
      user, session, loading, serials, serialsLoading,
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
