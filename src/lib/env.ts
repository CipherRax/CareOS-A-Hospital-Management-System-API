import { z } from 'zod';

/**
 * Environment validation.
 *
 * Parsed once at module load and exported as a frozen object, so a missing or
 * malformed variable fails the build rather than the first request that happens
 * to touch it. `NEXT_PUBLIC_*` values are inlined into the client bundle, which
 * is exactly why none of them may hold a secret — the schema below enforces that
 * by having no secret-shaped variable in the public half.
 *
 * Every variable here is safe to expose to the browser. Secrets are never
 * referenced from client code; anything genuinely sensitive stays server-side
 * and is proxied through the Next server (see docs/decisions.md ADR-004).
 */
const serverSchema = z.object({
  /** Backend origin, server-side only. Keeps internal addressing out of the bundle. */
  API_INTERNAL_URL: z
    .url()
    .default('http://localhost:3001')
    .describe('Origin used by the Next server when proxying to the careOS API.'),

  /** Public API base path, not a full origin: requests go through our own origin. */
  NEXT_PUBLIC_API_BASE_PATH: z
    .string()
    .startsWith('/')
    .default('/api/v1')
    .describe('Path prefix for API calls. Same-origin so no CORS and no public host leak.'),

  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('careOS'),

  /** Enables the MSW browser mock. Must never be on in a production build. */
  NEXT_PUBLIC_ENABLE_MOCKS: z
    .enum(['true', 'false'])
    .default('false')
    .describe('Serve API mocks from the browser. Development and test only.'),

  NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS: z.enum(['true', 'false']).default('false'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function parse(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`);
  }

  // A mock handler reachable in production would serve fabricated clinical data
  // to real users. Fail the build rather than trust the flag.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.NEXT_PUBLIC_ENABLE_MOCKS === 'true') {
    throw new Error(
      'NEXT_PUBLIC_ENABLE_MOCKS must not be "true" when NODE_ENV=production. ' +
        'Mocked clinical responses must never be served to real users.',
    );
  }

  return Object.freeze(parsed.data);
}

export const env: ServerEnv = parse();

export const publicEnv = {
  apiBasePath: env.NEXT_PUBLIC_API_BASE_PATH,
  appName: env.NEXT_PUBLIC_APP_NAME,
  enableMocks: env.NEXT_PUBLIC_ENABLE_MOCKS === 'true',
  enableQueryDevtools: env.NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS === 'true',
} as const;
