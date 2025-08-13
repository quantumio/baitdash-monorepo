import { z } from "zod";
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  WEB_URL: z.string().url().optional(),
  API_URL: z.string().url().optional(),
  UBER_DIRECT_CLIENT_ID: z.string().min(1),
  UBER_DIRECT_CLIENT_SECRET: z.string().min(1),
  UBER_DIRECT_CUSTOMER_ID: z.string().min(1),
  UBER_DIRECT_SCOPE: z.string().default("eats.deliveries"),
  UBER_OAUTH_TOKEN_URL: z.string().url().default("https://login.uber.com/oauth/v2/token"),
  UBER_DIRECT_BASE_URL: z.string().url().default("https://api.uber.com/v1/"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_ISSUER: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60)
});
export function loadEnv(raw: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid environment: " + JSON.stringify(parsed.error.issues));
  return parsed.data;
}
