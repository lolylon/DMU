import { ORG_READINESS_TEMPLATE } from './readiness.template';
import { TECH_ROLES_NO_PMD } from '@miru/shared';

describe('W4 readiness + tech boundary', () => {
  it('has required manual and auto items for go-live gate', () => {
    const required = ORG_READINESS_TEMPLATE.filter((i) => i.required);
    expect(required.length).toBeGreaterThanOrEqual(8);
    expect(required.some((i) => i.kind === 'manual')).toBe(true);
    expect(required.some((i) => i.key === 'org_admin_user')).toBe(true);
    expect(required.some((i) => i.key === 'ncalayer_pilot_ready')).toBe(true);
  });

  it('keeps unique readiness keys', () => {
    const keys = ORG_READINESS_TEMPLATE.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('documents tech roles that must not see PMD (TZ 11.2)', () => {
    expect(TECH_ROLES_NO_PMD).toEqual(
      expect.arrayContaining(['TECH_IMPLEMENTATION', 'TECH_SUPPORT', 'PLATFORM_ADMIN']),
    );
  });
});
