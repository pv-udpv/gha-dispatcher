import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const schema = process.env.SUPABASE_SCHEMA || "gha_dispatcher";

if (!url || !serviceKey) {
  console.warn(
    "[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — dispatch logging will be skipped.",
  );
}

// Service-role client, server-side only. Service role bypasses RLS.
export const supabase =
  url && serviceKey
    ? createClient(url, serviceKey, {
        db: { schema },
        auth: { persistSession: false, autoRefreshToken: false },
        // Node 20 has no native WebSocket; provide ws for the realtime client
        // constructor (we never actually open a realtime channel).
        realtime: { transport: ws as any },
        global: { headers: { "X-Client-Info": "gha-dispatcher" } },
      })
    : null;

export const DISPATCH_LOG_TABLE = "dispatch_log";
