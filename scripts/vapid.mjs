// Makes the key pair the Worker uses to sign bike-timer pushes. Run once: node scripts/vapid.mjs
// It prints two commands; run them (each asks you to paste the value it shows). Keep the private value secret.
import { webcrypto as crypto } from "node:crypto";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const privateJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));

console.log("1. npx wrangler secret put VAPID_PUBLIC_KEY\n   paste:\n   " + publicKey + "\n");
console.log("2. npx wrangler secret put VAPID_PRIVATE_JWK\n   paste (one line, keep it secret):\n   " + privateJwk + "\n");
console.log("Then: npm run deploy:stats");
