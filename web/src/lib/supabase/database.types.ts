export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.17" };
  szusownik: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          display_name: string;
          share_enabled: boolean;
        };
        Insert: {
          user_id: string;
          display_name: string;
          share_enabled?: boolean;
        };
        Update: {
          user_id?: string;
          display_name?: string;
          share_enabled?: boolean;
        };
        Relationships: [];
      };
      live_locations: {
        Row: {
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy_m: number;
          recorded_at: string;
        };
        Insert: {
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy_m: number;
          recorded_at: string;
        };
        Update: {
          user_id?: string;
          latitude?: number;
          longitude?: number;
          accuracy_m?: number;
          recorded_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type SupabaseProfile = Database["szusownik"]["Tables"]["profiles"]["Row"];
export type SupabaseLiveLocation = Database["szusownik"]["Tables"]["live_locations"]["Row"];
