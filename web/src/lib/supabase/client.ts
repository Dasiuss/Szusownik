import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

// This is the publishable client key, not a service-role secret. RLS is the
// security boundary for every request made from the PWA.
export const SUPABASE_URL = "https://qxxiujhtjffwptubvcih.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KZHlKoj3Cdmiq9kLx0Un1g_PGXkKojI";
export const SUPABASE_SCHEMA = "szusownik" as const;

export const supabase = createClient<Database, "szusownik">(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    db: { schema: SUPABASE_SCHEMA },
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  },
);
