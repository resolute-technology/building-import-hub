import { createClient } from "@supabase/supabase-js";
import { MAX_BODY_BYTES, parseBuildings, UploadError } from "../_shared/buildings.ts";

// Wildcard origins support Firebase preview channels and Lovable. Credentials are
// explicit bearer tokens, never cookies; CORS is not the authentication boundary.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new UploadError("Request too large");
  const reader = req.body?.getReader();
  if (!reader) throw new UploadError("Missing request body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new UploadError("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createImportHandler(getEnv: (name: string) => string | undefined) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    const match = /^Bearer ([^\s,]+)$/i.exec(authorization ?? "");
    if (!match) return reply({ error: "Unauthorized" }, 401);

    try {
      const url = getEnv("SUPABASE_URL");
      const keys = JSON.parse(getEnv("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
      const key =
        keys?.default ?? getEnv("SUPABASE_PUBLISHABLE_KEY") ?? getEnv("SUPABASE_ANON_KEY");
      if (!url || !key || typeof key !== "string" || key.startsWith("sb_secret_")) {
        return reply({ error: "Backend configuration error" }, 500);
      }
      const supabase = createClient(url, key, {
        global: { headers: { Authorization: authorization! } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Online verification before reading or parsing any caller-supplied upload.
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(match[1]);
      if (error || !user) return reply({ error: "Invalid session" }, 401);
      if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return reply({ error: "Expected application/json" }, 415);
      }
      let result: ReturnType<typeof parseBuildings>;
      try {
        const body = await readBody(req);
        result = parseBuildings(
          typeof body === "object" && body !== null && "fileBase64" in body
            ? body.fileBase64
            : undefined,
          user.id,
        );
      } catch (error) {
        return reply(
          {
            error:
              error instanceof UploadError ? error.message : "Unable to process the spreadsheet",
          },
          400,
        );
      }
      if (result.rows.length) {
        // The anon/publishable key plus the caller JWT keeps RLS active.
        const { error } = await supabase.from("buildings").insert(result.rows);
        if (error) return reply({ error: "Database import failed" }, 500);
      }
      return reply({ inserted: result.rows.length, skipped: result.skipped });
    } catch {
      return reply({ error: "Import service unavailable" }, 500);
    }
  };
}
