// apps/identity/src/lib/mfa-crypto.ts
// Encrypts the TOTP secret at rest using MFA_ENCRYPTION_KEY (AES-256-GCM via
// Web Crypto - Workers-native). The column is named totp_secret_encrypted
// in the schema; this is what actually makes that name true (it previously
// stored the raw base32 secret in plaintext - a real gap, fixed here).

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;

async function deriveKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', keyMaterial, ALGORITHM, false, ['encrypt', 'decrypt']);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/** Returns hex: iv (12 bytes) + ciphertext (includes the GCM auth tag). */
export async function encryptMfaSecret(plainText: string, encryptionKey: string): Promise<string> {
  if (!encryptionKey) throw new Error('MFA_ENCRYPTION_KEY is not configured.');
  const key = await deriveKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plainText)
  );
  return toHex(iv) + toHex(new Uint8Array(ciphertext));
}

export async function decryptMfaSecret(
  encryptedHex: string,
  encryptionKey: string
): Promise<string> {
  if (!encryptionKey) throw new Error('MFA_ENCRYPTION_KEY is not configured.');
  const key = await deriveKey(encryptionKey);
  const bytes = fromHex(encryptedHex);
  const iv = bytes.slice(0, IV_LENGTH);
  const ciphertext = bytes.slice(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
