import { createClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

const SUPABASE_URL      = 'https://vbaewualqaxhbmqgnhdt.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// The sign-in is kept on the phone, so the app opens on site with no
// signal (an engineer couldn't sign in there). The token refreshes itself
// whenever there's a connection.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
