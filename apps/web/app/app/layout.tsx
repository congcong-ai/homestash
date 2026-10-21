import type { Metadata } from "next";
import InternalSession from "../../components/internal-session";
export const metadata: Metadata = {
  title: "我的厨房 · FreshMate",
  robots: { index: false, follow: false },
};
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <InternalSession
        localLan={process.env.HOMESTASH_LAN_ENABLED === "true"}
      />
      {children}
    </>
  );
}
