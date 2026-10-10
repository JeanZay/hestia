import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { ClassificationCredentialCipher } from "./types";

/** Domain-separated server secret. No credential is returned by the HTTP API. */
export function createClassificationCredentialCipher(secret: string): ClassificationCredentialCipher {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new Error("Classification encryption unavailable");
  const key = Buffer.from(hkdfSync("sha256", secret, "hestia.classification.v1", "credential-at-rest", 32));
  return {
    seal(credential, associatedData) {
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(associatedData));
      const sealed = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
      return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), sealed.toString("base64url")].join(".");
    },
    open(sealed, associatedData) {
      try {
        const parts = sealed.split(".");
        if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
        const nonce = Buffer.from(parts[1], "base64url"), tag = Buffer.from(parts[2], "base64url");
        if (nonce.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(Buffer.from(associatedData)); decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
      } catch { throw new Error("Classification encryption unavailable"); }
    },
  };
}
