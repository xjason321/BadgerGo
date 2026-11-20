// A phone for tests: its push keys, and what it can open (RFC 8291 section 3.4, from the receiving side).
import { expect } from "vitest";
import { b64uEncode } from "../webpush";

const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
const dec = new TextDecoder();

export async function phone() {
  const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => [...x]));
  const t = new TextEncoder();
  return {
    pub, auth,
    sub: (endpoint = "https://fcm.googleapis.com/fcm/send/abc") => ({ endpoint, keys: { p256dh: b64uEncode(pub), auth: b64uEncode(auth) } }),
    async open(body: Uint8Array): Promise<string> {
      const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20]!;
      const asPub = body.slice(21, 21 + idlen), sealed = body.slice(21 + idlen);
      expect(rs).toBe(4096);
      const sender = await crypto.subtle.importKey("raw", asPub, ecdh, false, []);
      const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: sender } as unknown as SubtleCryptoDeriveKeyAlgorithm, pair.privateKey, 256));
      const prk = await hkdf(auth, secret, cat(t.encode("WebPush: info\0"), pub, asPub), 32);
      const cek = await hkdf(salt, prk, t.encode("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, prk, t.encode("Content-Encoding: nonce\0"), 12);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), sealed));
      expect(plain.at(-1)).toBe(2); // the last-record delimiter
      return dec.decode(plain.slice(0, -1));
    },
  };
}
