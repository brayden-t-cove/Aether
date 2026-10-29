import { describe, expect, it } from 'vitest';
import { periodLabel, resolvePeriod, weeksForRange } from '../client/src/lib/returnPeriods.js';

const at = (query) => resolvePeriod(new URLSearchParams(query), '2026-10-28');

describe('returns periods', () => {
  it('defaults to month to date', () => {
    expect(at('')).toEqual({ key: 'mtd', from: '2026-10-01', to: '2026-10-28', month: '2026-10', label: 'October 2026 (so far)' });
  });

  it('works out each preset from today', () => {
    expect(at('period=last_month')).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'September 2026' });
    expect(at('period=last_3_months')).toMatchObject({ from: '2026-08-01', to: '2026-10-28', label: 'Aug – Oct 2026 (so far)' });
    expect(at('period=qtd')).toMatchObject({ from: '2026-10-01', to: '2026-10-28' });
    expect(at('period=ytd')).toMatchObject({ from: '2026-01-01', to: '2026-10-28', label: 'Jan – Oct 2026 (so far)' });
    expect(at('period=last_12_months')).toMatchObject({ from: '2025-11-01', to: '2026-10-28', label: 'Nov 2025 – Oct 2026 (so far)' });
  });

  it('shows one chosen month, never one in the future', () => {
    expect(at('month=2026-08')).toMatchObject({ key: 'month', from: '2026-08-01', to: '2026-08-31', month: '2026-08', label: 'August 2026' });
    expect(at('month=2027-01')).toMatchObject({ month: '2026-10', to: '2026-10-28' });
  });

  it('takes a custom range, cut at today, and falls back to month to date when it is not valid', () => {
    expect(at('period=custom&from=2026-09-03&to=2026-10-14')).toMatchObject({ key: 'custom', from: '2026-09-03', to: '2026-10-14', label: 'Sep 3 – Oct 14, 2026' });
    expect(at('period=custom&from=2026-09-03&to=2026-12-31')).toMatchObject({ to: '2026-10-28' });
    expect(at('period=custom&from=2026-10-14&to=2026-09-03')).toMatchObject({ key: 'mtd' });
  });

  it('labels ranges across years and part months', () => {
    expect(periodLabel('2025-12-15', '2026-01-10', '2026-10-28')).toBe('Dec 15, 2025 – Jan 10, 2026');
  });

  it('covers a custom range with whole Monday-to-Sunday weeks', () => {
    // Oct 5, 2026 is a Monday (week 41); Oct 14 is in week 42.
    expect(weeksForRange('2026-10-05', '2026-10-14')).toEqual({ weeks: 2, end: '2026-10-14' });
    expect(weeksForRange('2026-01-01', '2026-10-28').weeks).toBe(44);
  });
});
