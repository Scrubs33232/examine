/** Persists the list of target wallets to watch. These are public Solana
 * addresses — no secrecy concerns, unlike the bot's own signing key — so
 * this is safe to manage entirely through the control API / website UI. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";

function validateAddress(address: string): void {
  try {
    new PublicKey(address);
  } catch {
    throw new Error(`"${address}" is not a valid Solana address`);
  }
}

function load(): string[] {
  if (existsSync(config.targetWalletsPath)) {
    try {
      const raw = JSON.parse(readFileSync(config.targetWalletsPath, "utf-8"));
      if (Array.isArray(raw)) return raw;
    } catch {
      // fall through to env seed below
    }
  }
  return config.targetWalletsSeed;
}

function save(wallets: string[]): void {
  writeFileSync(config.targetWalletsPath, JSON.stringify(wallets, null, 2));
}

export class TargetWalletStore {
  private wallets: string[] = load();

  list(): string[] {
    return [...this.wallets];
  }

  add(address: string): string[] {
    validateAddress(address);
    if (!this.wallets.includes(address)) {
      this.wallets.push(address);
      save(this.wallets);
    }
    return this.list();
  }

  remove(address: string): string[] {
    this.wallets = this.wallets.filter((w) => w !== address);
    save(this.wallets);
    return this.list();
  }
}
