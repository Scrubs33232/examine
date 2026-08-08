/** Key encryption/decryption and wallet safety guards.
 *
 * Keys are encrypted at rest with AES-256-GCM using a 32-byte key from
 * WALLET_ENCRYPTION_KEY (env-var-backed, never committed). The decrypted
 * secret key only ever exists in memory for the lifetime of the process —
 * it is never logged, and redactPubkey() should be used for any log line
 * that touches wallet identity.
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { settingsStore } from "./settingsStore.js";

const ALGO = "aes-256-gcm";

interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

function getEncryptionKey(): Buffer {
  const hex = config.encryptionKeyHex;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "WALLET_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecretKey(secretKey: Uint8Array): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), tag: tag.toString("hex"), data: encrypted.toString("hex") };
}

export function decryptSecretKey(payload: EncryptedPayload): Uint8Array {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, "hex")), decipher.final()]);
  return new Uint8Array(decrypted);
}

/** One-time onboarding helper — encrypts a raw secret key array and writes it
 * to disk with restrictive permissions. Called from scripts/encrypt-key.ts,
 * never at request/runtime. */
export function encryptAndSaveKeypair(secretKey: Uint8Array, outPath: string): void {
  const payload = encryptSecretKey(secretKey);
  writeFileSync(outPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  console.log(`[security] encrypted keypair written to ${outPath} (mode 600)`);
}

export function loadBotKeypair(): Keypair {
  if (!existsSync(config.encryptedKeyPath)) {
    throw new Error(
      `No encrypted keypair found at ${config.encryptedKeyPath}. Run:\n` +
        `  npm run encrypt-key -- <path-to-raw-solana-keypair.json>\n` +
        `first — see README.md.`
    );
  }
  const payload = JSON.parse(readFileSync(config.encryptedKeyPath, "utf-8")) as EncryptedPayload;
  const secretKey = decryptSecretKey(payload);
  const keypair = Keypair.fromSecretKey(secretKey);

  if (config.expectedBotPubkey && keypair.publicKey.toBase58() !== config.expectedBotPubkey) {
    throw new Error(
      `Decrypted keypair (${keypair.publicKey.toBase58()}) does not match BOT_WALLET_PUBKEY in .env ` +
        `(${config.expectedBotPubkey}). Refusing to start — this check exists specifically to catch loading ` +
        `the wrong encrypted key file before it trades with the wrong wallet.`
    );
  }

  return keypair;
}

export function redactPubkey(pubkey: PublicKey): string {
  const s = pubkey.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Warns (does not block) if the bot wallet holds more than the configured
 * safety limit. This bot has no per-trade human confirmation step, so a bug,
 * a bad target trade, or a rugged mint can lose funds fast — it's designed
 * to run against a small dedicated execution wallet, not a main holdings one. */
export async function assertBalanceGuard(connection: Connection, pubkey: PublicKey): Promise<void> {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  const sol = lamports / 1e9;
  console.log(`[security] bot wallet balance: ${sol.toFixed(4)} SOL`);

  const maxSafeWalletSol = settingsStore.get().maxSafeWalletSol;
  if (sol > maxSafeWalletSol) {
    console.warn(
      `\n⚠️  WARNING: this wallet holds ${sol.toFixed(2)} SOL, above the configured safety limit of ` +
        `${maxSafeWalletSol} SOL (editable from the website's Copy Trader settings panel).\n` +
        `   Use a dedicated burner/execution wallet funded only with what you're willing to risk fully —\n` +
        `   there is no per-trade confirmation once this is running live.\n`
    );
  }
}
