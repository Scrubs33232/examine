/** One-time onboarding: encrypts a raw Solana CLI keypair file
 * (e.g. from `solana-keygen new`) into the AES-256-GCM file the bot reads
 * at startup. Run manually — never called by the bot itself.
 *
 *   npm run encrypt-key -- /path/to/raw-keypair.json
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { encryptAndSaveKeypair } from "../src/security.js";
import { config } from "../src/config.js";

const rawPath = process.argv[2];
if (!rawPath) {
  console.error("Usage: npm run encrypt-key -- <path-to-raw-solana-keypair.json>");
  process.exit(1);
}

const secretKeyArray = JSON.parse(readFileSync(rawPath, "utf-8")) as number[];
if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
  console.error("Expected a raw Solana CLI keypair file: a JSON array of 64 numbers.");
  process.exit(1);
}

encryptAndSaveKeypair(new Uint8Array(secretKeyArray), config.encryptedKeyPath);

console.log(`\nDone. The bot now reads ${config.encryptedKeyPath} at startup.`);
console.log("Delete or securely archive the original raw keypair file — it's no longer needed to run the bot,");
console.log("and it's the one file in this whole system that isn't encrypted.");
