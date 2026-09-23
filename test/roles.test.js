import { describe, expect, it } from 'vitest';
import { hasRole } from '../shared/roles.js';

describe('hasRole', () => {
  it('ranks admin > editor > viewer', () => {
    expect(hasRole('admin', 'editor')).toBe(true);
    expect(hasRole('editor', 'editor')).toBe(true);
    expect(hasRole('viewer', 'editor')).toBe(false);
    expect(hasRole('editor', 'admin')).toBe(false);
  });

  it('rejects unknown roles', () => {
    expect(hasRole(undefined, 'viewer')).toBe(false);
    expect(hasRole('superuser', 'viewer')).toBe(false);
  });
});
