import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const SERIAL_STORAGE_KEY = "meercop_serial_key";
const SERIAL_DATA_KEY = "meercop_serial_data";

interface SerialSessionData {
  user_id: string;
  device_id: string;
  serial_key: string;
  plan_type: string;
  expires_at: string | null;
  remaining_days: number | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** 시리얼 세션에서 가져온 user_id (Supabase Auth가 없을 때 사용) */
  serialUserId: string | null;
  /** 시리얼 세션 데이터 전체 */
  serialSession: SerialSessionData | null;
  /** Supabase Auth user_id 또는 시리얼 user_id (어느 쪽이든 사용 가능한 ID) */
  effectiveUserId: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getSerialSession(): SerialSessionData | null {
  try {
    const raw = localStorage.getItem(SERIAL_DATA_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      localStorage.removeItem(SERIAL_STORAGE_KEY);
      localStorage.removeItem(SERIAL_DATA_KEY);
      return null;
    }
    return data as SerialSessionData;
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [serialSession, setSerialSession] = useState<SerialSessionData | null>(getSerialSession);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Create profile on signup
        if (event === "SIGNED_IN" && session?.user) {
          setTimeout(() => {
            createProfileIfNotExists(session.user.id);
          }, 0);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 시리얼 세션 변경 감지 (localStorage 변경 시)
  useEffect(() => {
    const handleStorage = () => {
      setSerialSession(getSerialSession());
    };
    window.addEventListener("storage", handleStorage);
    // 컴포넌트 마운트 시에도 다시 확인
    setSerialSession(getSerialSession());
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const createProfileIfNotExists = async (userId: string) => {
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from("profiles").insert({
        user_id: userId,
      });
    }
  };

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    // 시리얼 세션 데이터도 함께 삭제
    localStorage.removeItem(SERIAL_STORAGE_KEY);
    localStorage.removeItem(SERIAL_DATA_KEY);
    setSerialSession(null);
    await supabase.auth.signOut();
  };

  const serialUserId = serialSession?.user_id || null;
  // 시리얼 세션의 user_id를 우선 사용 (기기가 시리얼의 user_id로 등록되므로)
  const effectiveUserId = serialUserId || user?.id;

  return (
    <AuthContext.Provider value={{ 
      user, session, loading, signUp, signIn, signOut,
      serialUserId, serialSession, effectiveUserId,
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