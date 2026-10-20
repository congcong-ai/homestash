import type { Metadata } from "next";
import LoginForm from "./login-form";
export const metadata: Metadata = {
  title: "内部测试登录 · HomeStash",
  robots: { index: false, follow: false },
};
export default function LoginPage() {
  return <LoginForm />;
}
