import { z } from 'zod';

// Treat empty strings as unset so blank keys in .env don't fail .datetime().
const optionalIsoDatetime = z
  .preprocess((v) => (v === '' ? undefined : v), z.string().datetime({ offset: true }).optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().length(64, 'SESSION_SECRET must be 32 bytes hex (64 chars)'),
  FRONTEND_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  GAME_END_AT: optionalIsoDatetime,
  GAME_NOW_OVERRIDE: optionalIsoDatetime,
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  // Temporary admin gate. Static credentials from env until the real role
  // model (Azure OID list / Employee.isAdmin) is decided. See
  // middleware/auth.ts requireAdmin and routes/adminAuth.ts.
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(8),
  // Dev-only "log in as any employee" route. Strictly opt-in: only the literal
  // string "true" enables it. Anything else (unset, "false", "1", "yes") is
  // treated as off so a typo can't accidentally unlock the bypass. The boot
  // guard below also refuses to start when this is on in production.
  DEV_LOGIN_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // empeo HR API credentials for the admin "Sync from HR" flow. Required when
  // HR_API_FIXTURE !== 'true'; when fixture mode is on the sync reads
  // scripts/response.json locally so these can be unset for dev.
  EMPEO_CLIENT_ID: z.string().optional(),
  EMPEO_CLIENT_SECRET: z.string().optional(),
  EMPEO_SUBSCRIPTION_KEY: z.string().optional(),
  // Strict "true" opt-in like DEV_LOGIN_ENABLED. When on, empeoClient skips
  // the real HTTP calls and serves scripts/response.json — used for local
  // dev and offline testing.
  HR_API_FIXTURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  if (parsed.data.DEV_LOGIN_ENABLED && parsed.data.NODE_ENV === 'production') {
    console.error(
      'DEV_LOGIN_ENABLED=true is not allowed when NODE_ENV=production. ' +
        'The dev login route bypasses Azure SSO and must never be exposed in prod.',
    );
    process.exit(1);
  }
  return parsed.data;
})();

export const isProd = env.NODE_ENV === 'production';