// sealed-secret.ts — OPEN A SEALED SECRET with the secrets key of the deployment that sealed it:
// the cell is a `SealedSecretCell` (core/lib/src/api.ts), opened the way the deployment opens it
// (core/os/src/secret-at-rest.ts `decryptSecretMaterial`), so a cell moved to another path or pin
// does not open.
import type { SecretMaterial } from "iterate/api";
import type { SealedSecret } from "./archive.ts";

/** The material in `sealed`, opened with the source deployment's `current` secrets key, or its
 *  `previous` one during a rotation. Throws when neither opens it. */
export async function openSealedSecret(
  sealed: SealedSecret,
  keys: { current: string; previous?: string },
): Promise<SecretMaterial> {
  const encoder = new TextEncoder();
  const bytesOf = (base64: string) =>
    Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const additionalData = encoder.encode(
    JSON.stringify([
      "iterate-secret",
      2,
      sealed.context,
      [...new Set(sealed.urls)].sort(),
      sealed.nonce,
    ]),
  );
  const open = async (secretsKey: string) => {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretsKey));
    const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesOf(sealed.material.iv), additionalData },
      key,
      bytesOf(sealed.material.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  };
  try {
    return await open(keys.current);
  } catch (error) {
    if (!keys.previous) throw error;
    return await open(keys.previous);
  }
}
