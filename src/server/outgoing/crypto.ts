import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
/** Separate key purposes and AAD; never return ciphertext or fingerprints to the browser. */
export function outgoingCrypto(secret: string) {
  const key = (purpose: string) => Buffer.from(hkdfSync('sha256', secret, 'hestia.outgoing.v1', purpose, 32));
  const encryption = key('composition-aes-gcm'), signing = key('binding-hmac');
  const mac = (purpose: string, ...parts: unknown[]) => createHmac('sha256', signing).update(JSON.stringify([purpose,...parts])).digest('hex');
  function matches(a: string, b: string) { return /^[a-f0-9]{64}$/.test(a) && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b)); }
  function seal(value: unknown, aad: string) {
    const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',encryption,nonce); cipher.setAAD(Buffer.from(aad));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([nonce,encrypted,cipher.getAuthTag()]).toString('base64url');
  }
  function open<T>(value: string, aad: string): T {
    const bytes=Buffer.from(value,'base64url'); if(bytes.length<29)throw new Error('OUTGOING_CIPHERTEXT_INVALID');
    const cipher=createDecipheriv('aes-256-gcm',encryption,bytes.subarray(0,12)); cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8')) as T;
  }
  return {mac,matches,seal,open};
}
