import { Connection, PublicKey } from "@solana/web3.js";

export interface HolderData {
  top10HolderPct: number | null;
  devWalletSolBalance: number | null;
}

export async function fetchHolderConcentration(
  connection: Connection,
  mintAddress: string,
  creatorAddress: string | null
): Promise<HolderData> {
  let top10HolderPct: number | null = null;
  let devWalletSolBalance: number | null = null;

  try {
    const mint = new PublicKey(mintAddress);
    const [largest, supply] = await Promise.all([
      connection.getTokenLargestAccounts(mint),
      connection.getTokenSupply(mint),
    ]);

    const totalSupply = Number(supply.value.amount);
    if (totalSupply > 0) {
      const top10 = largest.value.slice(0, 10).reduce((sum, acc) => sum + Number(acc.amount), 0);
      top10HolderPct = (top10 / totalSupply) * 100;
    }
  } catch {
    // RPC failure or invalid mint — leave as null, UI shows "unavailable".
  }

  if (creatorAddress) {
    try {
      const lamports = await connection.getBalance(new PublicKey(creatorAddress));
      devWalletSolBalance = lamports / 1e9;
    } catch {
      devWalletSolBalance = null;
    }
  }

  return { top10HolderPct, devWalletSolBalance };
}
