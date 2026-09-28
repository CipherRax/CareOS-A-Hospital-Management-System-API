import { parseEnv, type Env } from '../../src/config/env.schema';

/**
 * Builds a real parsed `Env` for unit tests. Going through `parseEnv` (rather
 * than casting a literal) means a new required env var breaks these tests the
 * same way it breaks the application, and defaults stay the real defaults.
 */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://careos:careos@localhost:5432/careos?schema=public',
    DATABASE_DIRECT_URL: 'postgresql://careos:careos@localhost:5432/careos?schema=public',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    ...overrides,
  } as NodeJS.ProcessEnv);
}
