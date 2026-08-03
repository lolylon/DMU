export const TIMEZONE = 'Asia/Almaty';

/** Staff / admin roles that require 2FA (NFR 3.3, TZ §4) */
export const ROLES_REQUIRING_2FA = [
  'AMBULATORY_WORKER',
  'CONSULTANT',
  'REGISTRAR',
  'DEPARTMENT_HEAD',
  'ORG_ADMIN',
  'AUDITOR',
  'TECH_IMPLEMENTATION',
  'TECH_SUPPORT',
  'PLATFORM_ADMIN',
] as const;

/** Roles that must never see PMD content (TZ 4.3, 11.2) */
export const TECH_ROLES_NO_PMD = [
  'TECH_IMPLEMENTATION',
  'TECH_SUPPORT',
  'PLATFORM_ADMIN',
] as const;

export const CASE_STATUSES = [
  'CREATED',
  'AWAITING_CONSENT',
  'AWAITING_BOOKING',
  'BOOKED',
  'IN_SESSION',
  'AWAITING_CONCLUSION',
  'AWAITING_SIGNATURE',
  'AWAITING_PATIENT_DELIVERY',
  'CLOSED',
  'CANCELLED',
  'RESCHEDULED',
  'NO_SHOW',
  'OVERDUE',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Main path transitions from TZ §6.1 status model */
export const CASE_MAIN_FLOW: CaseStatus[] = [
  'CREATED',
  'AWAITING_CONSENT',
  'AWAITING_BOOKING',
  'BOOKED',
  'IN_SESSION',
  'AWAITING_CONCLUSION',
  'AWAITING_SIGNATURE',
  'AWAITING_PATIENT_DELIVERY',
  'CLOSED',
];

export const CASE_SIDE_STATUSES: CaseStatus[] = [
  'CANCELLED',
  'RESCHEDULED',
  'NO_SHOW',
  'OVERDUE',
];

const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password123',
    'password1234',
    '123456789012',
    '1234567890123',
    'qwertyuiopas',
    'qwertyuiopasd',
    'adminadmin12',
    'adminadmin123',
    'welcome12345',
    'changeme1234',
    'miru12345678',
  ].map((p) => p.toLowerCase()),
);

/** NFR 3.2: min 12 chars, common-password dictionary check */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 12) {
    return 'Password must be at least 12 characters';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common';
  }
  return null;
}

/** Kazakhstan IIN control digit (FrontDesk TZ 7.1.1) */
export function isValidIin(iin: string): boolean {
  if (!/^\d{12}$/.test(iin)) return false;
  const weights1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const weights2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  const digits = iin.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += digits[i]! * weights1[i]!;
  let control = sum % 11;
  if (control === 10) {
    sum = 0;
    for (let i = 0; i < 11; i++) sum += digits[i]! * weights2[i]!;
    control = sum % 11;
  }
  if (control === 10) return false;
  return control === digits[11];
}

export function canTransitionCaseStatus(
  from: CaseStatus,
  to: CaseStatus,
  opts?: { hasConsent?: boolean },
): string | null {
  if (from === to) return 'Status unchanged';
  if (from === 'CLOSED' || from === 'CANCELLED') {
    return `Case in terminal status ${from} cannot transition`;
  }

  // After reschedule, case returns to booking (TZ 6.2.5)
  if (from === 'RESCHEDULED' && (to === 'AWAITING_BOOKING' || to === 'BOOKED')) {
    return null;
  }

  if (CASE_SIDE_STATUSES.includes(to)) {
    if (to === 'CANCELLED' || to === 'RESCHEDULED') return null;
    if (to === 'NO_SHOW' && (from === 'BOOKED' || from === 'IN_SESSION')) return null;
    if (to === 'OVERDUE') return null;
    return `Invalid side transition ${from} → ${to}`;
  }

  const fromIdx = CASE_MAIN_FLOW.indexOf(from);
  const toIdx = CASE_MAIN_FLOW.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return `Unknown status in transition ${from} → ${to}`;
  if (toIdx !== fromIdx + 1) {
    return `Main flow allows only next step; got ${from} → ${to}`;
  }

  // TZ 7.1.6: no booking without consent acceptance
  if (to === 'AWAITING_BOOKING' && opts?.hasConsent === false) {
    return 'Consent acceptance required before booking';
  }

  return null;
}

export type Locale = 'kk' | 'ru';
