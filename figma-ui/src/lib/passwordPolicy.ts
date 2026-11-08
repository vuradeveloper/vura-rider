/**
 * One password policy for signup, change-password and the reset help text.
 *
 * Firebase Auth also enforces this server-side (min 8 + upper/lower/number/
 * symbol), so a modified client cannot create a weak account. This file is the
 * friendly UX layer: the checklist and the error shown before a request.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

export interface PasswordRule {
  id: string;
  label: string;
  met: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: 'length', label: 'At least 8 characters', met: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'max', label: 'No more than 64 characters', met: password.length <= PASSWORD_MAX_LENGTH },
    { id: 'lower', label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { id: 'upper', label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { id: 'number', label: 'One number', met: /[0-9]/.test(password) },
    { id: 'symbol', label: 'One symbol (!@#$…)', met: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function passwordIsStrong(password: string): boolean {
  return passwordRules(password).every((rule) => rule.met);
}

/** A single human message for the first missing rule, or null when strong. */
export function passwordError(password: string): string | null {
  if (!password) return 'Create a password first.';
  const missing = passwordRules(password).filter((rule) => !rule.met);
  if (missing.length === 0) return null;
  return `Password must include: ${missing.map((rule) => rule.label.toLowerCase()).join(', ')}.`;
}
