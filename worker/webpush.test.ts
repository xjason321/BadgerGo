import { describe, expect, it } from "vitest";
import { b64uDecode, b64uEncode, encryptPayload, sendPush, vapidFromEnv, vapidHeader } from "./webpush";

const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
const dec = new TextDecoder();

/** A phone: its push keys and what it can open. Follows RFC 8291 section 3.4 from the receiving side. */
async function phone() {
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

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    pair,
    vapid: {
      publicKey: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
      privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
      subject: "https://badgergo.app",
    },
  };
}

describe("encrypted payload", () => {
  it("the phone can open exactly what was sent", async () => {
    const p = await phone();
    const msg = JSON.stringify({ title: "29 min left free", body: "Dock before it runs out" });
    expect(await p.open(await encryptPayload(new TextEncoder().encode(msg), p.pub, p.auth))).toBe(msg);
  });
  it("a different phone can't", async () => {
    const a = await phone(), b = await phone();
    await expect(b.open(await encryptPayload(new TextEncoder().encode("secret"), a.pub, a.auth))).rejects.toThrow();
  });
  it("a new key and salt every time", async () => {
    const p = await phone();
    const x = await encryptPayload(new TextEncoder().encode("same"), p.pub, p.auth);
    const y = await encryptPayload(new TextEncoder().encode("same"), p.pub, p.auth);
    expect(b64uEncode(x)).not.toBe(b64uEncode(y));
  });
});

describe("VAPID", () => {
  it("is signed with the site's key, for the push service it is sent to, valid for under a day", async () => {
    const { pair, vapid } = await vapidKeys();
    const now = Date.UTC(2026, 10, 20, 18);
    const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    expect(m[4]).toBe(vapid.publicKey);
    const claims = JSON.parse(dec.decode(b64uDecode(m[2]!)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "https://badgergo.app" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64uDecode(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true);
    expect(b64uDecode(m[3]!)).toHaveLength(64); // the raw r||s form JWTs use
    expect(b64uDecode(m[4]!)).toHaveLength(65);
  });
});

describe("sendPush", () => {
  it("posts the encrypted message with the headers a push service needs, and returns its status", async () => {
    const p = await phone(), { vapid } = await vapidKeys();
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    const status = await sendPush(p.sub(), { title: "hi" }, vapid, Date.now(), 120, fetcher);
    expect(status).toBe(201);
    const { url, init } = seen[0]!;
    expect(url).toBe("https://fcm.googleapis.com/fcm/send/abc");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "120", Urgency: "high" });
    expect(JSON.parse(await p.open(init.body as Uint8Array))).toEqual({ title: "hi" });
  });
  it("passes on a gone subscription", async () => {
    const p = await phone(), { vapid } = await vapidKeys();
    expect(await sendPush(p.sub(), {}, vapid, Date.now(), 60, (async () => new Response(null, { status: 410 })) as unknown as typeof fetch)).toBe(410);
  });
});

describe("push settings", () => {
  it("are read from the Worker's secrets, and absent when incomplete or broken", async () => {
    const { vapid } = await vapidKeys();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_JWK: JSON.stringify(vapid.privateJwk) })).toMatchObject({ publicKey: vapid.publicKey, subject: "https://badgergo.app" });
    expect(vapidFromEnv({})).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "x" })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_JWK: "{not json" })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_JWK: JSON.stringify({ kty: "EC" }) })).toBeNull(); // no private part
  });
  it("base64url round trip, and refuses other text", () => {
    const bytes = Uint8Array.from([251, 255, 0, 1, 62, 63]);
    expect(b64uDecode(b64uEncode(bytes))).toEqual(bytes);
    expect(() => b64uDecode("not valid!")).toThrow();
  });
});
