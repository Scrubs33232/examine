import SolanaWalletProvider from "@/components/SolanaWalletProvider";

export default function MirrorLayout({ children }: { children: React.ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
