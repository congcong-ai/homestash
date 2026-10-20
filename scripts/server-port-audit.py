#!/usr/bin/env python3
"""只读审计监听端口与服务配置；不会启动、停止或修改任何服务。"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class PortUse:
    port: int
    state: str
    source: str
    detail: str


def run(command: list[str]) -> str:
    try:
        return subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=15
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def add(result: set[PortUse], port: int, state: str, source: str, detail: str) -> None:
    if 1 <= port <= 65535:
        result.add(PortUse(port, state, source, detail[:240]))


def inspect_process(pid: int) -> str:
    parts: list[str] = []
    for label, path in (
        ("cwd", f"/proc/{pid}/cwd"),
        ("cmd", f"/proc/{pid}/cmdline"),
        ("cgroup", f"/proc/{pid}/cgroup"),
    ):
        try:
            if label == "cwd":
                value = os.readlink(path)
            else:
                value = open(path, "rb").read(4096).replace(b"\x00", b" ").decode("utf-8", "replace").strip()
            if value:
                parts.append(f"{label}={value}")
        except OSError:
            continue
    return "; ".join(parts)


def listening_uses() -> set[PortUse]:
    result: set[PortUse] = set()
    output = run(["ss", "-H", "-lntup"])
    for line in output.splitlines():
        columns = line.split()
        if len(columns) < 5:
            continue
        local = columns[4]
        match = re.search(r":(\d+)$", local)
        if not match:
            continue
        port = int(match.group(1))
        pid_match = re.search(r"pid=(\d+)", line)
        pid_detail = inspect_process(int(pid_match.group(1))) if pid_match else ""
        add(result, port, "LISTEN", "ss", f"{line}; {pid_detail}".strip("; "))
    return result


def configured_uses() -> set[PortUse]:
    result: set[PortUse] = set()
    sources: list[tuple[str, str]] = []
    nginx_dump = run(["nginx", "-T"])
    if nginx_dump:
        # 保留 nginx -T 中每个文件的归属，避免把本站预留端口当成其它站点。
        sections = re.split(r"(?m)^# configuration file ([^\n]+):\s*\n", nginx_dump)
        if sections[0].strip():
            sources.append(("nginx -T", sections[0]))
        for index in range(1, len(sections), 2):
            sources.append((os.path.realpath(sections[index]), sections[index + 1]))
    for pattern in (
        "/etc/nginx/sites-available/*",
        "/etc/supervisor/conf.d/*",
        "/etc/systemd/system/*.service",
    ):
        for path in glob.glob(pattern):
            try:
                sources.append((path, open(path, encoding="utf-8", errors="replace").read()))
            except OSError:
                continue

    for source, content in sources:
        for match in re.finditer(r"\blisten\s+(?:\[[^]]+\]|[\w.*-]+:)?(\d+)\b", content):
            add(result, int(match.group(1)), "CONFIG", source, "listen")
        for match in re.finditer(r"\bproxy_pass\s+https?://[^\s;:]+:(\d+)\b", content):
            add(result, int(match.group(1)), "CONFIG", source, "upstream")
        for match in re.finditer(r"\bserver\s+(?:\[[^]]+\]|[\w.*-]+):(\d+)\b", content):
            add(result, int(match.group(1)), "CONFIG", source, "upstream server")
        for match in re.finditer(r"(?:--port(?:=|\s+)|\bPORT=)(\d+)\b", content):
            add(result, int(match.group(1)), "CONFIG", source, "service command")

    for path in glob.glob("/var/lib/*/.pm2/dump.pm2") + glob.glob("/home/*/.pm2/dump.pm2") + ["/root/.pm2/dump.pm2"]:
        try:
            entries = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name", "unknown"))
            environments = [entry]
            pm2_env = entry.get("pm2_env")
            if isinstance(pm2_env, dict):
                environments.append(pm2_env)
                nested_env = pm2_env.get("env")
                if isinstance(nested_env, dict):
                    environments.append(nested_env)
            for key in ("WEB_PORT", "API_PORT", "CORE_PORT", "PORT"):
                for environment in environments:
                    value = environment.get(key)
                    if isinstance(value, (str, int)) and str(value).isdigit():
                        add(result, int(value), "CONFIG", path, f"PM2 {name} {key}")

    if shutil.which("docker"):
        for line in run(["docker", "ps", "--format", "{{.Names}}|{{.Ports}}"]).splitlines():
            for match in re.finditer(r"(?:0\.0\.0\.0|\[::\]|127\.0\.0\.1):(\d+)->", line):
                add(result, int(match.group(1)), "CONFIG", "docker ps", line)
    return result


def collect() -> list[PortUse]:
    return sorted(listening_uses() | configured_uses(), key=lambda item: (item.port, item.state, item.source))


def choose(uses: list[PortUse]) -> tuple[int, int]:
    reserved = {item.port for item in uses}
    for web in range(3000, 9000, 2):
        if web not in reserved and web + 1 not in reserved:
            return web, web + 1
    raise SystemExit("没有找到一对可用 TCP 端口")


def find_conflicts(uses: list[PortUse], ports: list[int], project_nginx: str | None = None) -> list[PortUse]:
    def own_reservation(item: PortUse) -> bool:
        return bool(project_nginx and item.state == "CONFIG" and item.detail in ("upstream", "upstream server")
                    and os.path.realpath(item.source) == os.path.realpath(project_nginx))
    return [item for item in uses if item.port in ports and not own_reservation(item)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--choose", action="store_true")
    parser.add_argument("--check", nargs=2, type=int, metavar=("WEB_PORT", "API_PORT"))
    parser.add_argument("--project-nginx", help="检查时允许本项目 Nginx 的 upstream 预留；仍拒绝实际监听及其它项目配置")
    args = parser.parse_args()
    if args.project_nginx:
        if not args.check:
            parser.error("--project-nginx 必须与 --check 一起使用")
        with open(args.project_nginx, encoding="utf-8") as handle:
            if not handle.read().startswith("# 由 HomeStash 安装器管理\n"):
                parser.error("指定 Nginx 配置不属于 HomeStash 安装器")
    uses = collect()

    if args.choose:
        web, api = choose(uses)
        print(json.dumps({"web_port": web, "api_port": api}))
        return

    if args.check:
        conflicts = find_conflicts(uses, args.check, args.project_nginx)
        if conflicts:
            print(json.dumps({"available": False, "conflicts": [asdict(item) for item in conflicts]}, ensure_ascii=False, indent=2))
            raise SystemExit(1)
        print(json.dumps({"available": True, "ports": args.check}, ensure_ascii=False))
        return

    web, api = choose(uses)
    print(
        json.dumps(
            {
                "uses": [asdict(item) for item in uses],
                "suggestion": {"web_port": web, "api_port": api},
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
