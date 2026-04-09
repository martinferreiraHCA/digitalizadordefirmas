/**
 * Uruguayan CI (Cédula de Identidad) formatting and validation.
 * Format: X.XXX.XXX-X
 */

export function formatCI(raw) {
  const digits = raw.replace(/\D/g, '');
  let f = '';
  if (digits.length >= 1) f = digits.slice(0, 1);
  if (digits.length >= 2) f += '.' + digits.slice(1, Math.min(4, digits.length));
  if (digits.length >= 5) f += '.' + digits.slice(4, Math.min(7, digits.length));
  if (digits.length >= 8) f += '-' + digits.slice(7, 8);
  return f;
}

export function getDigits(value) {
  return value.replace(/\D/g, '');
}

export function isValidCI(value) {
  return getDigits(value).length >= 7;
}
