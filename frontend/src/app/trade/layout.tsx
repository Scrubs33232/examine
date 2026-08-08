import SolanaWalletProvider from "@/components/SolanaWalletProvider";

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
