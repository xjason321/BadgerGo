// Sends a Web Push message (RFC 8030) with an encrypted payload (RFC 8291, aes128gcm) and a VAPID signature
// (RFC 8292), using only WebCrypto: no libraries.
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
export interface Vapid { publicKey: string; privateJwk: JsonWebKey; subject: string }

const enc = new TextEncoder();

export const b64uEncode = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** Throws on text that isn't base64url. */
export function b64uDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** The request body for one message to a subscription's public key (`p256dh`, 65 bytes) and secret (`auth`, 16 bytes). */
export async function encryptPayload(plain: Uint8Array, p256dh: Uint8Array, auth: Uint8Array): Promise<Uint8Array> {
  const eph = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPub = new Uint8Array((await crypto.subtle.exportKey("raw", eph.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, eph.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(auth, secret, concat(enc.encode("WebPush: info\0"), p256dh, asPub), 32);
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plain, Uint8Array.of(2))));
  // Header: salt, record size (4096), key length, the sender's public key.
  return concat(salt, Uint8Array.of(0, 0, 0x10, 0, asPub.length), asPub, sealed);
}

/** The Authorization header that proves the message comes from the site that owns the VAPID key. */
export async function vapidHeader(endpoint: string, vapid: Vapid, nowMs: number): Promise<string> {
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64uEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: vapid.subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64uEncode(sig)}, k=${vapid.publicKey}`;
}

/** Sends `payload` (JSON) to the subscription. Resolves to the push service's HTTP status (201 delivered; 404/410 the subscription is gone). */
export async function sendPush(sub: PushSub, payload: unknown, vapid: Vapid, nowMs: number, ttlSec: number, fetcher: typeof fetch = fetch): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), b64uDecode(sub.keys.p256dh), b64uDecode(sub.keys.auth));
  const res = await fetcher(sub.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttlSec), Urgency: "high", Authorization: await vapidHeader(sub.endpoint, vapid, nowMs) },
    body,
  });
  return res.status;
}

/** The VAPID settings from the Worker's secrets, or null when push isn't set up (the app then falls back to its own notifications). */
export function vapidFromEnv(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string }): Vapid | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return null;
  try {
    const privateJwk = JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey;
    return privateJwk.kty === "EC" && privateJwk.d ? { publicKey: env.VAPID_PUBLIC_KEY, privateJwk, subject: "https://badgergo.app" } : null;
  } catch { return null; }
}
