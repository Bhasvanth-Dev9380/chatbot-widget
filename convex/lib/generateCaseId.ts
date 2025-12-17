/**
 * Generates a unique alphanumeric case ID
 * Format: CASE-XXXXXX where X is alphanumeric (uppercase letters and numbers)
 * Example: CASE-A7B2C9
 */
export function generateCaseId(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length = 6;
  let caseId = 'CASE-';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    caseId += characters[randomIndex];
  }

  return caseId;
}
