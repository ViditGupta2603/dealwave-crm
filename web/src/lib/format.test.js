import { describe, expect, it } from 'vitest';
import { cap, initials, rupees, rupeesShort, timeAgo } from './format';
import { fillTemplate } from '../components/RecordExtras';

describe('rupee formatting', () => {
  it('uses Indian digit grouping', () => expect(rupees(12345678)).toBe('₹1,23,45,678'));
  it('shortens to lakh and crore', () => {
    expect(rupeesShort(4500000)).toBe('₹45 L');
    expect(rupeesShort(25900000)).toBe('₹2.59 Cr');
    expect(rupeesShort(12300)).toBe('₹12,300');
  });
  it('handles missing values', () => {
    expect(rupees(null)).toBe('-');
    expect(rupeesShort(undefined)).toBe('-');
  });
});

describe('text helpers', () => {
  it('initials', () => {
    expect(initials('Rajesh Sundaram')).toBe('RS');
    expect(initials('')).toBe('?');
  });
  it('cap', () => expect(cap('lost_reason')).toBe('Lost reason'));
  it('timeAgo', () => {
    expect(timeAgo(new Date())).toBe('just now');
    expect(timeAgo(null)).toBe('-');
  });
});

describe('email templates', () => {
  it('fills known placeholders and blanks unknown ones', () => {
    expect(fillTemplate('Hi {{ name }} from {{company}}, {{nope}}', { name: 'Ramesh', company: 'Ashoka Mills' })).toBe(
      'Hi Ramesh from Ashoka Mills, ',
    );
  });
});
