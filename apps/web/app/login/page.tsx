import type { Metadata } from "next";
import LoginForm from "./login-form";
export const metadata: Metadata = {
  title:
    process.env.HOMESTASH_LAN_ENABLED === "true"
      ? "家庭访问登录 · HomeStash"
      : "内部测试登录 · HomeStash",
  robots: { index: false, follow: false },
};
export default function LoginPage() {
  return <LoginForm localLan={process.env.HOMESTASH_LAN_ENABLED === "true"} />;
}
