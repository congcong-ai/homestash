import type { Metadata } from "next";
import LoginForm from "./login-form";
import { redirect } from "next/navigation";
export const metadata: Metadata = {
  title:
    process.env.HOMESTASH_LAN_ENABLED === "true"
      ? "家庭访问登录 · HomeStash"
      : "内部测试登录 · HomeStash",
  robots: { index: false, follow: false },
};
export default function LoginPage() {
  if (
    process.env.INTERNAL_LOGIN_ENABLED !== "true" ||
    process.env.HOMESTASH_LAN_ENABLED === "true"
  )
    redirect("/app");
  return <LoginForm localLan={process.env.HOMESTASH_LAN_ENABLED === "true"} />;
}
