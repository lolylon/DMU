import {
  canTransitionCaseStatus,
  isValidIin,
  validatePasswordPolicy,
} from '@miru/shared';

describe('NFR/TZ policy helpers', () => {
  describe('password policy (NFR 3.2)', () => {
    it('rejects short passwords', () => {
      expect(validatePasswordPolicy('short')).toMatch(/12/);
    });

    it('rejects common passwords', () => {
      expect(validatePasswordPolicy('password1234')).toMatch(/common/i);
    });

    it('accepts strong passwords', () => {
      expect(validatePasswordPolicy('ChangeMeNow!99')).toBeNull();
    });
  });

  describe('case status model (TZ 6.1)', () => {
    it('allows sequential main flow', () => {
      expect(canTransitionCaseStatus('CREATED', 'AWAITING_CONSENT')).toBeNull();
    });

    it('blocks skipping', () => {
      expect(canTransitionCaseStatus('CREATED', 'BOOKED')).toMatch(/next step/i);
    });

    it('blocks booking without consent', () => {
      expect(
        canTransitionCaseStatus('AWAITING_CONSENT', 'AWAITING_BOOKING', { hasConsent: false }),
      ).toMatch(/Consent/i);
    });

    it('allows booking with consent', () => {
      expect(
        canTransitionCaseStatus('AWAITING_CONSENT', 'AWAITING_BOOKING', { hasConsent: true }),
      ).toBeNull();
    });

    it('allows booking after reschedule', () => {
      expect(canTransitionCaseStatus('RESCHEDULED', 'BOOKED')).toBeNull();
    });
  });

  describe('IIN', () => {
    it('rejects malformed IIN', () => {
      expect(isValidIin('000')).toBe(false);
    });

    it('accepts valid control digit', () => {
      expect(isValidIin('880101300000')).toBe(true);
      expect(isValidIin('900000000009')).toBe(true);
    });
  });
});
