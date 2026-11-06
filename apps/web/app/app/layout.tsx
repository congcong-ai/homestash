import type { Metadata } from "next";
import InternalSession from "../../components/internal-session";
export const metadata: Metadata = {
  title: "萌小冰 · 食灵小院",
  robots: { index: false, follow: false },
};
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {process.env.INTERNAL_LOGIN_ENABLED === "true" &&
        process.env.HOMESTASH_LAN_ENABLED !== "true" && <InternalSession />}
      {children}
    </>
  );
}
