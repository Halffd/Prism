// Supabase configuration
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

// Get Supabase config from environment variables
const supabaseConfig: SupabaseConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-anon-key',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
};

// Create Supabase client
export const supabaseClient: SupabaseClient = createClient(
  supabaseConfig.url,
  supabaseConfig.anonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        'X-Client-Info': 'prism-client/1.0.0'
      }
    }
  }
);

export default supabaseConfig;