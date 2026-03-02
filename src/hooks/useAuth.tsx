import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { websiteSupabase, fetchUserSerials, UserSerial } from "@/lib/websiteAuth";

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

  useEffect(() => {
    const { data: { subscription } } = websiteSupabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);

        if (newSession?.access_token) {
          // Defer serial fetch to avoid blocking auth state
          setTimeout(() => loadSerials(newSession.access_token), 0);
        } else {
          setSerials([]);
        }
      }
    );

    websiteSupabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      setLoading(false);
      if (existing?.access_token) {
        loadSerials(existing.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await websiteSupabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (_email: string, _password: string) => {
    return { error: new Error("Signup is only available on the MeerCOP website.") };
  };

  const signOut = async () => {
    // Cleanup legacy serial data
    localStorage.removeItem(SERIAL_STORAGE_KEY);
    localStorage.removeItem(SERIAL_DATA_KEY);
    setSerials([]);
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
