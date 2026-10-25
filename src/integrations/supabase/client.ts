import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

function createSupabaseClient() {
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building.");
  }
  if (key.startsWith("sb_secret_")) {
    throw new Error("Use a Supabase publishable key in the browser.");
  }
  // Legacy anon JWTs are also supported; service-role JWTs must never reach Vite.
  if (!key.startsWith("sb_publishable_")) {
    let role: string | undefined;
    try {
      role = JSON.parse(atob(key.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).role;
    } catch {
      throw new Error("Invalid Supabase publishable or anon key.");
    }
    if (role !== "anon") throw new Error("Use a Supabase publishable or anon key in the browser.");
  }
  return createClient<Database>(url, key, {
    auth: {
      storage: brokeredPreviewStorage(),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let client: ReturnType<typeof createSupabaseClient> | undefined;
// Lazy initialization lets the build generate the static shell without running Auth.
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop) {
    client ??= createSupabaseClient();
    return Reflect.get(client, prop, client);
  },
});
