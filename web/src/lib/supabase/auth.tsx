import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { SupabaseProfile } from "./database.types.ts";
import { supabase } from "./client.ts";
import { deleteLiveLocation } from "./liveLocations.ts";
import { getOrCreateProfile, updateOwnProfile } from "./profiles.ts";

interface SupabaseAuthContextValue {
  session: Session | null;
  user: User | null;
  profile: SupabaseProfile | null;
  authLoading: boolean;
  profileLoading: boolean;
  signingOut: boolean;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setDisplayName(displayName: string): Promise<void>;
  setShareEnabled(enabled: boolean): Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SupabaseProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session?.user ?? null;

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) setProfile(null);
    });

    void supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) setError(sessionError.message);
        setSession(data.session);
        setAuthLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(errorMessage(caught));
        setAuthLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return undefined;
    }

    setProfile(null);
    setProfileLoading(true);
    void getOrCreateProfile(user)
      .then((nextProfile) => {
        if (active) {
          setProfile(nextProfile);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) throw signInError;
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setError(null);
    let locationDeleteError: unknown = null;
    try {
      if (user) {
        try {
          await deleteLiveLocation(user.id);
        } catch (caught) {
          locationDeleteError = caught;
        }
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;

      if (locationDeleteError) {
        setError(`Wylogowano, ale nie udało się usunąć ostatniej pozycji: ${errorMessage(locationDeleteError)}`);
      }
    } finally {
      setSigningOut(false);
    }
  }, [user]);

  const setDisplayName = useCallback(async (displayName: string) => {
    if (!user) throw new Error("Zaloguj się, aby zmienić nazwę profilu.");
    setError(null);
    const nextProfile = await updateOwnProfile(user.id, { display_name: displayName });
    setProfile(nextProfile);
  }, [user]);

  const setShareEnabled = useCallback(async (enabled: boolean) => {
    if (!user) throw new Error("Zaloguj się, aby zmienić udostępnianie lokalizacji.");
    setError(null);
    const nextProfile = await updateOwnProfile(user.id, { share_enabled: enabled });
    setProfile(nextProfile);

    if (!enabled) {
      try {
        await deleteLiveLocation(user.id);
      } catch (caught) {
        throw new Error(`Udostępnianie wyłączono, ale nie udało się usunąć ostatniej pozycji: ${errorMessage(caught)}`);
      }
    }
  }, [user]);

  const value = useMemo<SupabaseAuthContextValue>(() => ({
    session,
    user,
    profile,
    authLoading,
    profileLoading,
    signingOut,
    error,
    signIn,
    signOut,
    setDisplayName,
    setShareEnabled,
  }), [session, user, profile, authLoading, profileLoading, signingOut, error, signIn, signOut, setDisplayName, setShareEnabled]);

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>;
}

export function useSupabaseAuth(): SupabaseAuthContextValue {
  const context = useContext(SupabaseAuthContext);
  if (!context) throw new Error("useSupabaseAuth musi być użyte wewnątrz SupabaseAuthProvider.");
  return context;
}
