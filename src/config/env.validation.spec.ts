import { validateEnv } from './env.validation';

const VALID = {
  DATABASE_URL:
    'postgresql://user:pass@localhost:5432/ledgercore?schema=public',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  WEBHOOK_SECRET: 'another-secret-at-least-32-characters-long',
  REDIS_HOST: 'localhost',
  REDIS_PORT: 6379,
};

describe('validateEnv', () => {
  it('accepts a complete configuration', () => {
    expect(() => validateEnv(VALID)).not.toThrow();
  });

  it('applies defaults for optional settings', () => {
    const config = validateEnv(VALID);
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.JWT_EXPIRES_IN_SECONDS).toBe(900);
    expect(config.REDIS_DB).toBe(0);
  });

  it('rejects a missing DATABASE_URL', () => {
    const withoutUrl = { ...VALID, DATABASE_URL: undefined };
    expect(() => validateEnv(withoutUrl)).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL with no protocol', () => {
    expect(() =>
      validateEnv({ ...VALID, DATABASE_URL: 'localhost:5432/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...VALID, DATABASE_URL: 'mysql://u:p@localhost:3306/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...VALID, JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects a short WEBHOOK_SECRET', () => {
    expect(() => validateEnv({ ...VALID, WEBHOOK_SECRET: 'nope' })).toThrow(
      /WEBHOOK_SECRET/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...VALID, PORT: 99999 })).toThrow(/PORT/);
  });

  it('rejects a token expiry under a minute', () => {
    expect(() => validateEnv({ ...VALID, JWT_EXPIRES_IN_SECONDS: 30 })).toThrow(
      /JWT_EXPIRES_IN_SECONDS/,
    );
  });

  it('rejects a Redis database index outside 0-15', () => {
    expect(() => validateEnv({ ...VALID, REDIS_DB: 16 })).toThrow(/REDIS_DB/);
  });

  it('coerces numeric strings, since env vars are always strings', () => {
    const config = validateEnv({ ...VALID, PORT: '4000', REDIS_PORT: '6380' });
    expect(config.PORT).toBe(4000);
    expect(config.REDIS_PORT).toBe(6380);
  });

  it('reports every problem at once, not just the first', () => {
    expect(() =>
      validateEnv({ ...VALID, JWT_SECRET: 'short', PORT: 99999 }),
    ).toThrow(/JWT_SECRET[\s\S]*PORT|PORT[\s\S]*JWT_SECRET/);
  });
});
