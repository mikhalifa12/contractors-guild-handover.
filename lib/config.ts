import { z } from 'zod';

/**
 * Server configuration.
 *
 * Configuration is parsed lazily (on first use) rather than at import time so
 * that `next build` never requires a live database, and so that tests can set
 * their own environment before the first query runs.
 *
 * Secrets live in environment variables only. Banking details are NOT
 * configuration: each business enters its own details inside the app and they
 * are stored in the database (see SECURITY.md).
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUBLIC_APP_URL: z.string().min(1).default('http://localhost:3000'),

  /**
   * Contact details shown on the public marketing site. These belong to the
   * business that owns the deployment, so they come from the environment
   * rather than being invented in the code. The defaults are obvious
   * placeholders: replace them before going live (see README.md).
   */
  PUBLIC_CONTACT_PHONE: z.string().default('+27 00 000 0000'),
  PUBLIC_CONTACT_WHATSAPP: z.string().default('+27000000000'),
  PUBLIC_CONTACT_EMAIL: z.string().default('hello@example.com'),
  PUBLIC_CONTACT_ADDRESS: z.string().default('Unit 1, Industrial Park, Your City'),
  PUBLIC_CONTACT_HOURS: z.string().default('Weekends and after hours by appointment'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (PostgreSQL connection string)'),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

  SESSION_COOKIE_NAME: z.string().min(1).default('cg_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PASSWORD_HASH_COST: z.coerce.number().int().min(4_096).default(16_384),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('data/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).default(2_097_152),
});

export type ServerConfig = z.infer<typeof serverEnvSchema> & {
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
};

let cachedConfig: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid server configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`
    );
  }

  const env = parsed.data;
  cachedConfig = {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    isDevelopment: env.NODE_ENV === 'development',
  };
  return cachedConfig;
}

/** Used by tests that switch database between suites. */
export function resetServerConfigCache(): void {
  cachedConfig = null;
}
