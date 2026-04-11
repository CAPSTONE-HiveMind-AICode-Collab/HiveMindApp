const SENSITIVE_PATTERNS = [
  {
    label: "email",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    label: "phone",
    regex: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    label: "id",
    regex: /\b\d{9,}\b/g,
  },
  {
    label: "token",
    regex: /\b[0-9A-Za-z]{20,}\b/g,
  },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 250000;
const ENCRYPTION_VERSION = "v1";

function getCryptoApi() {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable in this environment.");
  }
  return crypto;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase, salt) {
  const cryptoApi = getCryptoApi();
  const baseKey = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(String(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function createEphemeralPassphrase() {
  const bytes = new Uint8Array(32);
  getCryptoApi().getRandomValues(bytes);
  return bytesToBase64(bytes);
}

async function encryptValue(value, passphrase) {
  const cryptoApi = getCryptoApi();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);

  const cipherBuffer = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(String(value ?? ""))
  );

  return [
    ENCRYPTION_VERSION,
    bytesToBase64(salt),
    bytesToBase64(iv),
    bytesToBase64(new Uint8Array(cipherBuffer)),
  ].join(":");
}

async function replaceSensitiveSegmentsAsync(text, replacer) {
  let transformed = String(text || "");
  const placeholders = [];

  for (const pattern of SENSITIVE_PATTERNS) {
    const matches = Array.from(transformed.matchAll(pattern.regex));
    for (const match of matches) {
      const matchedValue = match[0];
      const placeholder = `__PROTECTED_${placeholders.length}__`;
      const replacement = await replacer(matchedValue, pattern);
      placeholders.push(replacement);
      transformed = transformed.replace(matchedValue, placeholder);
    }
  }

  return placeholders.reduce(
    (output, replacement, index) =>
      output.replace(`__PROTECTED_${index}__`, replacement),
    transformed
  );
}

export async function protectSensitiveData(text, options = {}) {
  if (!text || typeof text !== "string") return text || "";

  const decryptForAI = !!options?.decryptForAI;
  if (decryptForAI) {
    return String(text);
  }

  const passphrase = String(options?.passphrase || "").trim() || createEphemeralPassphrase();

  return replaceSensitiveSegmentsAsync(text, async (match, pattern) => {
    const cipherText = await encryptValue(match, passphrase);
    return `[encrypted-${pattern.label}:${cipherText}]`;
  });
}
