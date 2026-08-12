import { isValidSignature, signPayload } from './webhook-signature';

const SECRET = 'a-test-secret-that-is-long-enough-000000';
const BODY = JSON.stringify({
  event: 'charge.success',
  id: 'evt-1',
  data: { reference: 'DEP-20260812-ABC', amount: 500000 },
});

describe('webhook signature', () => {
  it('accepts a signature made with the same secret and body', () => {
    expect(isValidSignature(SECRET, BODY, signPayload(SECRET, BODY))).toBe(
      true,
    );
  });

  it('accepts a raw Buffer body', () => {
    const raw = Buffer.from(BODY, 'utf8');
    expect(isValidSignature(SECRET, raw, signPayload(SECRET, raw))).toBe(true);
  });

  it('rejects a body altered after signing', () => {
    const signature = signPayload(SECRET, BODY);
    const tampered = BODY.replace('500000', '999999');
    expect(isValidSignature(SECRET, tampered, signature)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const forged = signPayload(
      'a-different-secret-of-the-same-length-00',
      BODY,
    );
    expect(isValidSignature(SECRET, BODY, forged)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(isValidSignature(SECRET, BODY, undefined)).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(isValidSignature(SECRET, BODY, '')).toBe(false);
  });

  it('rejects a missing body', () => {
    expect(isValidSignature(SECRET, undefined, signPayload(SECRET, BODY))).toBe(
      false,
    );
  });

  it('rejects a truncated signature without throwing', () => {
    const short = signPayload(SECRET, BODY).slice(0, 32);
    expect(isValidSignature(SECRET, BODY, short)).toBe(false);
  });

  it('rejects a signature of the wrong encoding length', () => {
    expect(isValidSignature(SECRET, BODY, 'not-hex-at-all')).toBe(false);
  });

  it('produces a 128-character hex digest for sha512', () => {
    expect(signPayload(SECRET, BODY)).toMatch(/^[0-9a-f]{128}$/);
  });

  it('is whitespace sensitive, which is why raw bytes matter', () => {
    const reserialized = JSON.stringify(JSON.parse(BODY) as unknown, null, 2);
    expect(
      isValidSignature(SECRET, reserialized, signPayload(SECRET, BODY)),
    ).toBe(false);
  });
});
