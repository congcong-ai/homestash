import Link from "next/link";
import { githubUrl } from "../lib/site";

export function GithubLink({
  className = "",
  children = "GitHub ↗",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      className={className}
      href={githubUrl || "/#open-source"}
      {...(githubUrl ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}
export function Mark() {
  return (
    <svg
      width="29"
      height="31"
      viewBox="0 0 29 31"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 12 14.5 3 25 12v15H4V12Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M10 17h9M10 22h9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function MarketingHeader() {
  return (
    <header className="m-header">
      <Link href="/" className="m-logo" aria-label="HomeStash 首页">
        <Mark />
        homestash
      </Link>
      <nav aria-label="网站导航">
        <Link href="/#moments">生活里的用处</Link>
        <Link href="/applications">不止冰箱贴</Link>
        <GithubLink className="m-nav-github" />
      </nav>
    </header>
  );
}
export function MarketingFooter() {
  return (
    <footer className="m-footer">
      <Link href="/" className="m-logo">
        <Mark />
        homestash
      </Link>
      <p>少一点操心，多一点好好生活。</p>
      <div>
        <span>开源 · 本地优先 · MIT</span>
        <GithubLink />
        <Link href="/applications">更多可能 ↗</Link>
      </div>
    </footer>
  );
}
