// crypto.js — PIN hashing via the browser's own Web Crypto (PBKDF2-HMAC-SHA256).
//
// The PIN itself is never stored. A random salt plus a high iteration count
// makes guessing a short PIN by brute force meaningfully slower — though a
// 4-digit PIN has only 10,000 possible values, so this slows down someone
// flicking through an unlocked phone; it does not stop someone determined.
// This is a standard, spec-defined browser primitive, not something hand
// rolled here, so it behaves identically under test (Node's Web Crypto) and
// in Safari — there is no gap between what gets verified and what ships.

const ITERATIONS = 150000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(pin, saltBytes) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** A fresh salt + hash for a new PIN. Nothing here reveals the PIN itself. */
export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt);
  return { salt: toBase64(salt), hash: toBase64(hash) };
}

/** Re-derive with the stored salt and compare in constant time. */
export async function verifyPin(pin, salt, expectedHash) {
  const hash = await derive(pin, fromBase64(salt));
  const expected = fromBase64(expectedHash);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= hash[i] ^ expected[i];
  return diff === 0;
}
