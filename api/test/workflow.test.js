import { describe, expect, it } from 'vitest';
import { matches } from '../src/workflow/engine.js';

const rec = { status: 'new', score: 72, source: 'Website', city: '', custom_data: { budget_range: 'Above ₹2Cr' } };

describe('automation conditions', () => {
  it('passes when there are no conditions', () => expect(matches([], null, rec)).toBe(true));
  it('eq and neq', () => {
    expect(matches([{ field: 'source', op: 'eq', value: 'Website' }], null, rec)).toBe(true);
    expect(matches([{ field: 'source', op: 'neq', value: 'Website' }], null, rec)).toBe(false);
  });
  it('numeric comparisons', () => {
    expect(matches([{ field: 'score', op: 'gte', value: 70 }], null, rec)).toBe(true);
    expect(matches([{ field: 'score', op: 'gt', value: 72 }], null, rec)).toBe(false);
    expect(matches([{ field: 'score', op: 'lt', value: '80' }], null, rec)).toBe(true);
  });
  it('contains and in are case-insensitive', () => {
    expect(matches([{ field: 'source', op: 'contains', value: 'WEB' }], null, rec)).toBe(true);
    expect(matches([{ field: 'status', op: 'in', value: 'Qualified, NEW' }], null, rec)).toBe(true);
  });
  it('is_empty and not_empty', () => {
    expect(matches([{ field: 'city', op: 'is_empty' }], null, rec)).toBe(true);
    expect(matches([{ field: 'source', op: 'not_empty' }], null, rec)).toBe(true);
  });
  it('reads custom fields with the custom_data. prefix', () => {
    expect(matches([{ field: 'custom_data.budget_range', op: 'eq', value: 'Above ₹2Cr' }], null, rec)).toBe(true);
  });
  it('changed_to only fires when the value actually changed', () => {
    expect(matches([{ field: 'status', op: 'changed_to', value: 'new' }], { status: 'contacted' }, rec)).toBe(true);
    expect(matches([{ field: 'status', op: 'changed_to', value: 'new' }], { status: 'new' }, rec)).toBe(false);
  });
  it('all conditions must hold', () => {
    expect(
      matches(
        [
          { field: 'source', op: 'eq', value: 'Website' },
          { field: 'score', op: 'gt', value: 90 },
        ],
        null,
        rec,
      ),
    ).toBe(false);
  });
});
