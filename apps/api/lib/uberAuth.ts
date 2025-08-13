import { kv } from "./redis";
import { loadEnv } from "@baitdash/env";
const env = loadEnv(process.env);
let inMemoryToken: { accessToken: string; expiresAt: number } | null = null;

export async function getUberAccessToken(): Promise<string> {
  const now = Date.now();
  if (inMemoryToken && inMemoryToken.expiresAt - 30000 > now) return inMemoryToken.accessToken;
  const cached = await kv.get<{ token: string; exp: number }>("uber:access_token");
  if (cached && cached.exp - 30 > Math.floor(now / 1000)) {
    inMemoryToken = { accessToken: cached.token, expiresAt: cached.exp * 1000 };
    return cached.token;
  }
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", env.UBER_DIRECT_CLIENT_ID);
  form.set("client_secret", env.UBER_DIRECT_CLIENT_SECRET);
  if (env.UBER_DIRECT_SCOPE) form.set("scope", env.UBER_DIRECT_SCOPE);
  const res = await fetch(env.UBER_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (!res.ok) throw new Error(`Uber token error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number; token_type: string };
  const expiresAt = Math.floor(now / 1000) + (data.expires_in || 3600);
  inMemoryToken = { accessToken: data.access_token, expiresAt: expiresAt * 1000 };
  await kv.set("uber:access_token", { token: data.access_token, exp: expiresAt }, data.expires_in - 30);
  return data.access_token;
}
