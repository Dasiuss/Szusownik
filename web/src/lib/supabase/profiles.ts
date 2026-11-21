import type { User } from "@supabase/supabase-js";
import type { SupabaseProfile } from "./database.types.ts";
import { supabase } from "./client.ts";
import { defaultDisplayNameFromEmail, normalizeDisplayName } from "./profilePolicy.ts";

const PROFILE_COLUMNS = "user_id, display_name, share_enabled";

async function loadProfile(userId: string): Promise<SupabaseProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrCreateProfile(user: User): Promise<SupabaseProfile> {
  const existing = await loadProfile(user.id);
  if (existing) return existing;

  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id,
    display_name: defaultDisplayNameFromEmail(user.email ?? ""),
    share_enabled: true,
  }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw error;

  const profile = await loadProfile(user.id);
  if (!profile) throw new Error("Nie udało się przygotować profilu Supabase.");
  return profile;
}

export async function updateOwnProfile(
  userId: string,
  update: Partial<Pick<SupabaseProfile, "display_name" | "share_enabled">>,
): Promise<SupabaseProfile> {
  const normalized = update.display_name === undefined
    ? update
    : { ...update, display_name: normalizeDisplayName(update.display_name) };
  if (normalized.display_name === "") throw new Error("Nazwa nie może być pusta.");

  const { data, error } = await supabase
    .from("profiles")
    .update(normalized)
    .eq("user_id", userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}
