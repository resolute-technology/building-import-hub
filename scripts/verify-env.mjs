import { loadEnv } from "vite";

const env = { ...loadEnv(process.argv[2] || "production", process.cwd(), "VITE_"), ...process.env };
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building.");
if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("Invalid Supabase URL.");
let publicKey = key.startsWith("sb_publishable_");
if (!publicKey) {
  try {
    publicKey = JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role === "anon";
  } catch {
    /* rejected below */
  }
}
if (!publicKey)
  throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a public publishable or legacy anon key.");
console.log("Supabase public build configuration validated (values omitted).");
