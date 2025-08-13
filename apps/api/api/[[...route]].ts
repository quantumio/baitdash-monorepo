import { Hono } from "hono";
import { handle } from "@hono/vercel";
import { logger } from "hono/logger";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import pino from "pino";
import { loadEnv } from "@baitdash/env";
import { cors } from "hono/cors";
import { kv } from "../lib/redis";
import { getUberAccessToken } from "../lib/uberAuth";

export const config = { runtime: "nodejs", regions: ["iad1", "cdg1"] };

const env = loadEnv(process.env);
const app = new Hono().basePath("/v1");
const log = pino({ level: process.env.NODE_ENV === "production" ? "info" : "debug" });

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return false;
      const allowList = ["https://baitdash.app", /^https:\/\/.+\.vercel\.app$/];
      return allowList.some((rule) => (rule instanceof RegExp ? rule.test(origin) : rule === origin));
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    maxAge: 86400
  })
);

const deliverySchema = z.object({
  external_order_id: z.string(),
  pickup: z.object({
    address: z.string(),
    contact: z.object({ name: z.string(), phone: z.string() })
  }),
  dropoff: z.object({
    address: z.string(),
    contact: z.object({ name: z.string(), phone: z.string() })
  }),
  tip: z.number().optional()
});

app.get("/health", (c) => c.json({ ok: true }));

function getClientIdentifier(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const auth = req.headers.get("authorization");
  return auth ? `auth:${auth.slice(0, 16)}` : ip ? `ip:${ip}` : "ip:unknown";
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || attempt === maxRetries) return res;
    const backoffMs = Math.min(2000, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 100);
    await new Promise((r) => setTimeout(r, backoffMs));
    attempt++;
  }
  throw new Error("fetchWithRetry failed");
}

app.post("/deliveries", zValidator("json", deliverySchema), async (c) => {
  const body = c.req.valid("json");
  const idempotencyKey = c.req.header("Idempotency-Key") ?? crypto.randomUUID();

  const clientId = getClientIdentifier(c.req.raw);
  const windowSeconds = 60;
  const maxPerWindow = env.RATE_LIMIT_PER_MINUTE;
  const rateKey = `rl:${clientId}`;
  const count = await kv.incrementWithTtl(rateKey, windowSeconds);
  if (count > maxPerWindow) {
    return c.json({ error: "RATE_LIMIT_EXCEEDED" }, 429);
  }

  const cacheKey = `idem:deliveries:${idempotencyKey}`;
  const cached = await kv.get<{ status: number; body: string }>(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: { "Content-Type": "application/json", "Idempotent-Cache": "hit" }
    }) as any;
  }

  const token = await getUberAccessToken();
  const upstreamUrl = new URL(`customers/${env.UBER_DIRECT_CUSTOMER_ID}/deliveries`, env.UBER_DIRECT_BASE_URL).toString();
  const res = await fetchWithRetry(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    log.warn({ status: res.status, body: text }, "Uber Direct error");
    return c.json({ error: "UPSTREAM_ERROR", status: res.status }, res.status);
  }

  await kv.set(cacheKey, { status: res.status, body: text }, 60 * 5);
  return c.body(text, res.status);
});

export default handle(app);
