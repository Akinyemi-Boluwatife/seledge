import { periodBounds } from './statements.processor';

describe('periodBounds', () => {
  it('covers a whole month in UTC', () => {
    const { start, end } = periodBounds('2026-08');
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls December over into the next year', () => {
    const { start, end } = periodBounds('2026-12');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles January', () => {
    const { start, end } = periodBounds('2026-01');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('handles February in a leap year', () => {
    const { start, end } = periodBounds('2028-02');
    expect(start.toISOString()).toBe('2028-02-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });

  // The bounds are half-open so an entry at midnight on the 1st belongs to the
  // month starting, never to both months.
  it('treats the end boundary as exclusive', () => {
    const august = periodBounds('2026-08');
    const september = periodBounds('2026-09');
    expect(august.end.getTime()).toBe(september.start.getTime());
  });
});
