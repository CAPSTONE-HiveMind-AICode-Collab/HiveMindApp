// src/lib/business/privacyPolicyChecker.js

/**
 * Very simple privacy filter for AI prompts.
 * - Masks email addresses
 * - Masks long numeric IDs
 * - Masks phone-number-like patterns
 */
export function filterSensitiveData(text) {
  if (!text || typeof text !== "string") return text;

  let cleaned = text;

  // Mask emails: something@domain.com  → [email omitted]
  cleaned = cleaned.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[email omitted]"
  );

  // Mask long numeric IDs (9+ digits) → [id omitted]
  cleaned = cleaned.replace(/\b\d{9,}\b/g, "[id omitted]");

  // Mask phone-like patterns: 123-456-7890 / 123 456 7890 / (123) 456-7890
  cleaned = cleaned.replace(
    /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    "[phone omitted]"
  );

  return cleaned;
}