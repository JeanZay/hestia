import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export function identityCrypto(secret: string) {
  const key = (purpose: string) => Buffer.from(hkdfSync("sha256", secret, "hestia.identity.v1", purpose, 32));
  const macKey = key("proof-hmac"), cipherKey = key("temporary-aes-gcm");
  function digest(domain: string, ...parts: unknown[]) {
    return createHmac("sha256", macKey).update(JSON.stringify([domain,...parts])).digest("hex");
  }
  function matches(actual: string | null, expected: string) {
    return !!actual && actual.length === expected.length && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
  }
  function seal(value: unknown, aad: string) {
    const nonce=randomBytes(12), cipher=createCipheriv("aes-256-gcm",cipherKey,nonce);
    cipher.setAAD(Buffer.from(aad));
    const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),data]).toString("base64url");
  }
  function open<T>(value: string, aad: string): T {
    const packed=Buffer.from(value,"base64url");
    if (packed.length<29) throw new Error("IDENTITY_CIPHERTEXT_INVALID");
    const cipher=createDecipheriv("aes-256-gcm",cipherKey,packed.subarray(0,12));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(packed.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(packed.subarray(28)),cipher.final()]).toString("utf8"));
  }
  return {digest,matches,seal,open};
}
export const capability=()=>randomBytes(32).toString("base64url");
export function newCodes() {
  return Array.from({length:8},()=>`${randomBytes(6).toString("hex")}-${randomBytes(16).toString("hex").match(/.{8}/g)!.join("-")}`);
}
