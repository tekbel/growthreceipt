import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && publishableKey);
// Google stays hidden until the provider is set up in Supabase.
export const googleAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !publishableKey) return null;
  if (!client) {
    client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
