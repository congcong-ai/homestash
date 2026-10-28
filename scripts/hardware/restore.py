#!/usr/bin/env python3
"""将已校验的完整 HomeStash Flash 备份恢复到原开发板。"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BACKUP = ROOT / 'data/hardware/backups/homestash-20261027/manifest.json'
FLASH_BYTES = 16 * 1024 * 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, default=DEFAULT_BACKUP,
                        help='备份 manifest.json 路径，默认恢复 2026-10-27 的板上快照')
    parser.add_argument('--baud', type=int, choices=[115200, 230400, 460800], default=230400)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='只校验本地备份，不打开串口')
    mode.add_argument('--verify-only', action='store_true', help='只与板上整片 Flash 比对，不写入')
    args = parser.parse_args()

    manifest_path = args.backup.resolve()
    manifest = json.loads(manifest_path.read_text())
    image = (manifest_path.parent / manifest['file']).resolve()
    if image.parent != manifest_path.parent or manifest.get('verifiedAgainstFlash') is not True:
        raise ValueError('备份路径或设备校验标记无效')
    data = image.read_bytes()
    if len(data) != FLASH_BYTES or manifest['bytes'] != FLASH_BYTES:
        raise ValueError('备份必须是完整的 16 MiB Flash')
    if hashlib.sha256(data).hexdigest() != manifest['sha256']:
        raise ValueError('备份 SHA-256 不匹配')
    mac = manifest['mac'].lower()
    if not re.fullmatch(r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}', mac) or not manifest['usbSerial']:
        raise ValueError('备份中的设备身份无效')
    print(f'备份校验通过：{image}（{len(data)} 字节）', flush=True)
    if args.dry_run:
        print('本地预检通过，未打开串口、未烧录。')
        return

    from serial.tools import list_ports
    ports = [port.device for port in list_ports.comports()
             if port.serial_number == manifest['usbSerial']
             and port.vid == 0x10c4 and port.pid == 0xea60]
    if len(ports) != 1:
        raise ValueError('未发现唯一匹配的原开发板，请连接 USB UART 并关闭串口监视器')
    base = [sys.executable, '-m', 'esptool', '--chip', 'esp32s31',
            '--port', ports[0], '--baud', str(args.baud), '--no-stub']
    identity = subprocess.check_output(base + ['--after', 'no-reset', 'read-mac'], text=True)
    if not re.search(r'\bMAC:\s*' + re.escape(mac) + r'\b', identity, re.IGNORECASE):
        raise ValueError('开发板 MAC 与备份不匹配，已停止')

    # 使用已校验内容的临时副本，避免校验后原文件被替换。
    with tempfile.TemporaryDirectory(prefix='homestash-restore-') as temporary:
        snapshot = Path(temporary) / 'flash.bin'
        snapshot.write_bytes(data)
        if not args.verify_only:
            print('正在整片恢复 Flash，设备配置将回到备份时状态；请勿断电。', flush=True)
            subprocess.run(base + ['--after', 'no-reset', 'write-flash',
                                   '--flash-mode', 'keep', '--flash-size', 'keep',
                                   '--flash-freq', 'keep', '0x0', str(snapshot)], check=True)
        subprocess.run(base + ['verify-flash', '0x0', str(snapshot)], check=True)
    print('整片 Flash 与备份比对通过，已重启开发板。' if args.verify_only else
          '完整固件已写回，整片比对通过，已重启开发板；请检查屏幕与联网。')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f'恢复失败：{error}', file=sys.stderr)
        sys.exit(1)
