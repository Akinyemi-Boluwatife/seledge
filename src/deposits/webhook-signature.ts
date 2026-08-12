import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPayload(secret: string, rawBody: Buffer | string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export function isValidSignature(
  secret: string,
  rawBody: Buffer | string | undefined,
  provided: string | undefined,
): boolean {
  if (!rawBody || !provided) {
    return false;
  }

  const expected = Buffer.from(signPayload(secret, rawBody), 'utf8');
  const received = Buffer.from(provided, 'utf8');

  // Length must match before timingSafeEqual, and the comparison itself must
  // not short-circuit — an early exit leaks how much of a forgery was correct.
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
