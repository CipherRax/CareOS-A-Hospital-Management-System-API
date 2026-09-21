import { parseEnv, envSummary } from '../../src/config/env.schema';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://careos:careos@localhost:5432/careos?schema=public',
  DATABASE_DIRECT_URL: 'postgresql://careos:careos@localhost:5432/careos?schema=public',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
};

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    const env = parseEnv(validEnv as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('/api/v1');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.ENABLE_SWAGGER).toBe(true);
  });

  it('normalizes boolean-ish and numeric-ish, explicit false', () => {
    const env = parseEnv({
      ...validEnv,
      ENABLE_SWAGGER: 'false',
      METRICS_ENABLED: 'true',
      REDIS_DB: '2',
    } as NodeJS.ProcessEnv);
    expect(env.ENABLE_SWAGGER).toBe(false);
    expect(env.METRICS_ENABLED).toBe(true);
    expect(env.REDIS_DB).toBe(2);
  });

  it('parses CORS origins into an array', () => {
    const env = parseEnv({
      ...validEnv,
      CORS_ORIGINS: 'http://a.io, http://b.io',
    } as NodeJS.ProcessEnv);
    expect(env.CORS_ORIGINS).toEqual(['http://a.io', 'http://b.io']);
  });

  it('rejects config without a database URL', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects unknown NODE_ENV values', () => {
    expect(() =>
      parseEnv({ ...validEnv, NODE_ENV: 'boo' } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe('envSummary', () => {
  it('never emits secrets', () => {
    const summary = envSummary(parseEnv(validEnv as NodeJS.ProcessEnv));
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('careos:careos');
    expect(serialized).not.toContain('secret');
  });
});
