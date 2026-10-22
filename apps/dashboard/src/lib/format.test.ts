import { describe, expect, it } from 'vitest';

import { daysUntil, formatDate, param, scoreTone, truncate } from './format.js';

describe('format helpers', () => {
  it('formats dates and tolerates junk', () => {
    expect(formatDate('2026-10-22T08:00:00.000Z')).toBe('22 Oct 2026');
    expect(formatDate('2026-11-01')).toBe('1 Nov 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('yesterday')).toBe('yesterday');
  });

  it('counts days until a follow-up', () => {
    const today = new Date('2026-10-22T15:00:00Z');
    expect(daysUntil('2026-10-25', today)).toBe(3);
    expect(daysUntil('2026-10-20', today)).toBe(-2);
    expect(daysUntil(null, today)).toBeNull();
  });

  it('picks tones and truncates', () => {
    expect(scoreTone(4.5)).toContain('emerald');
    expect(scoreTone(3.2)).toContain('amber');
    expect(scoreTone(0)).toContain('slate-500');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });

  it('reads string params only', () => {
    expect(param({ a: 'x', b: ['y'], c: '' }, 'a')).toBe('x');
    expect(param({ a: 'x', b: ['y'], c: '' }, 'b')).toBeUndefined();
    expect(param({ a: 'x', b: ['y'], c: '' }, 'c')).toBeUndefined();
  });
});
