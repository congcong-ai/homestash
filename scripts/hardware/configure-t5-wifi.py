#!/usr/bin/env python3
"""在本机输入并保存T5 Wi-Fi配置，不打印密码、不通过命令行传递密码。"""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dialog', action='store_true', help='在macOS弹出本机输入框')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    target = root / 'firmware/boards/tuya-t5-ai/config.local.json'
    ignored = subprocess.run(['git', 'check-ignore', '-q', str(target)], cwd=root)
    if ignored.returncode != 0:
        raise RuntimeError('配置路径没有被Git忽略，拒绝保存凭据')
    if args.dialog:
        def ask(script):
            result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('本机输入已取消，未保存配置')
            return result.stdout.rstrip('\n')
        ssid = ask('text returned of (display dialog "请输入开发板要连接的 Wi-Fi 名称（与电脑同一局域网）" default answer "" buttons {"取消", "继续"} default button "继续" with title "萌小冰 · 本机配网")')
        password = ask('text returned of (display dialog "请输入 Wi-Fi 密码。仅保存到本机忽略文件，不发送到聊天。" default answer "" with hidden answer buttons {"取消", "保存"} default button "保存" with title "萌小冰 · 本机配网")')
    else:
        ssid = input('Wi-Fi名称：')
        password = getpass.getpass('Wi-Fi密码（不会显示）：')
    if not 1 <= len(ssid.encode()) <= 32 or '\0' in ssid:
        raise ValueError('Wi-Fi名称须为1—32字节')
    size = len(password.encode())
    if '\0' in password or not (8 <= size <= 63 or size == 64 and all(c in '0123456789abcdefABCDEF' for c in password)):
        raise ValueError('当前配网支持8—63字节密码或64位十六进制密钥')
    data = json.loads(target.read_text()) if target.exists() else {}
    data.update(wifiSsid=ssid, wifiPassword=password)
    temporary = target.with_suffix('.json.tmp')
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        temporary.unlink(missing_ok=True)
    print('Wi-Fi配置已保存到本机Git忽略文件；未输出凭据，未向设备发送。')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
