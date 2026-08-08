import SolanaWalletProvider from "@/components/SolanaWalletProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
