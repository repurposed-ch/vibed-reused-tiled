import { describe, expect, it } from 'vitest';
import { detectClientArProfile } from '@/export/user-agent';

describe('detectClientArProfile', () => {
  it('detects iPhone', () => {
    expect(detectClientArProfile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(
      'ios',
    );
  });

  it('detects iPadOS desktop UA', () => {
    expect(detectClientArProfile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
  });

  it('detects Android', () => {
    expect(detectClientArProfile('Mozilla/5.0 (Linux; Android 14)', 2)).toBe('android');
  });

  it('defaults to other', () => {
    expect(detectClientArProfile('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0)).toBe('other');
  });
});
