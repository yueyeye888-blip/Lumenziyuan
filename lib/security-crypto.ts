import { env } from "cloudflare:workers";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function settingsKey() {
  const encoded = env.SETTINGS_ENCRYPTION_KEY;
  if (!encoded) throw new Error("站点加密密钥尚未配置");
  return crypto.subtle.importKey("raw", base64ToBytes(encoded), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSetting(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await settingsKey(), new TextEncoder().encode(value));
  return { encryptedValue: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptSetting(encryptedValue: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await settingsKey(), base64ToBytes(encryptedValue));
  return new TextDecoder().decode(decrypted);
}

export async function hashPin(pin: string, encodedSalt?: string) {
  const salt = encodedSalt ? base64ToBytes(encodedSalt) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, material, 256);
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(salt) };
}

export async function verifyPin(pin: string, expectedHash: string, salt: string) {
  const actual = await hashPin(pin, salt);
  if (actual.hash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.hash.length; index += 1) difference |= actual.hash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}
