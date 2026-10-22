import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@jobhunt-hq/dashboard', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@jobhunt-hq/dashboard');
  });
});
