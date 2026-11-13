import { describe, expect, it } from 'vitest';
import { logoStorageKey } from '@/lib/storage';

describe('storage keys', () => {
  it('uses portable POSIX separators for logical logo keys', () => {
    const key = logoStorageKey('00000000-0000-4000-8000-000000000001', 'png');

    expect(key).toMatch(
      /^logos\/00000000-0000-4000-8000-000000000001\/[a-z0-9-]+\.png$/
    );
    expect(key).not.toContain('\\');
  });
});
