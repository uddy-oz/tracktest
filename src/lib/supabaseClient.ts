import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const sessionAwareAuthStorage = {
  getItem(key: string) {
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    let isAnonymous = false;
    try {
      const parsed = JSON.parse(value);
      isAnonymous = Boolean(
        parsed?.user?.is_anonymous || parsed?.currentSession?.user?.is_anonymous
      );
    } catch {
      // Non-session values use normal persistent auth storage.
    }

    if (isAnonymous) {
      window.sessionStorage.setItem(key, value);
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
      window.sessionStorage.removeItem(key);
    }
  },
  removeItem(key: string) {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  },
};

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { storage: sessionAwareAuthStorage },
    })
  : null;

export const isSupabaseConfigured = supabase !== null;
