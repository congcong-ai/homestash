#!/usr/bin/env python3
"""监听指定开发板；可选跨拔电重连、查询状态或触发录音。"""
import argparse
import sys
import time
import json
import os
import re
from pathlib import Path
import serial
from serial.tools import list_ports
from dotenv import dotenv_values

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--seconds', type=int, default=40)
parser.add_argument('--reset', action='store_true')
parser.add_argument('--record-seconds', type=float)
parser.add_argument('--screen', type=int, choices=range(6), help='切换 LCD 页面：0今日 1库存 2临期 3推荐 4做饭 5采购')
parser.add_argument('--photo', action='store_true', help='启动稳定后触发一次拍照')
parser.add_argument('--reconnect', action='store_true')
parser.add_argument('--status', action='store_true')
parser.add_argument('--command-file', help='读取本地命令行队列；仅输出命令名，不回显配置内容')
parser.add_argument('--ble-private-file', help='将UART一次性BLE信息写入权限600的本机文件；日志仍隐藏内容')
args = parser.parse_args()
config = dotenv_values(Path(__file__).resolve().parents[2] / 'data/hardware/device.env', interpolate=False)
deadline = time.monotonic() + args.seconds
device = None
connected_at = next_status = 0
sent = stopped = did_reset = False
command_count = 0
pending_output = b''
try:
    while time.monotonic() < deadline:
        if device is None:
            ports = [port.device for port in list_ports.comports() if port.serial_number == config['USB_SERIAL'] and port.vid == 0x10c4 and port.pid == 0xea60]
            if len(ports) != 1:
                if not args.reconnect:
                    raise SystemExit('未发现唯一匹配的开发板。')
                time.sleep(.5)
                continue
            device = serial.Serial()
            device.port = ports[0]
            device.baudrate = 115200
            device.timeout = .2
            device.dtr = device.rts = False
            try:
                device.open()
            except serial.SerialException:
                device.close()
                device = None
                if not args.reconnect:
                    raise SystemExit('无法打开开发板串口。')
                time.sleep(.5)
                continue
            connected_at = time.monotonic()
            next_status = connected_at + 3
            print('串口已连接。', flush=True)
            if args.reset and not did_reset:
                device.rts = True
                time.sleep(.1)
                device.rts = False
                did_reset = True
        try:
            now = time.monotonic()
            if args.screen is not None and now - connected_at > 15 and not sent:
                device.write(f'screen {args.screen}\n'.encode())
                sent = True
            if args.photo and now - connected_at > 15 and not sent:
                device.write(b'photo\n')
                sent = True
            if args.command_file and now - connected_at > 15:
                lines = Path(args.command_file).read_text().splitlines()
                for command in lines[command_count:]:
                    if command == '@reset':
                        device.rts = True
                        time.sleep(.1)
                        device.rts = False
                        print('\n已执行一次 UART 硬件复位（验收用途）。', flush=True)
                        continue
                    if len(command.encode()) > 1023 or "\r" in command:
                        raise SystemExit('配置命令过长或含有非法换行。')
                    payload = (command + '\n').encode()
                    for offset in range(0, len(payload), 48):
                        device.write(payload[offset:offset + 48])
                        device.flush()
                        time.sleep(.03)
                    time.sleep(.1)
                    name = command.split(' ', 1)[0]
                    print(f'\n已提交串口命令：{name}（参数不回显）', flush=True)
                command_count = len(lines)
            if args.record_seconds is not None:
                if now - connected_at > 2 and not sent:
                    device.write(b'record\n')
                    sent = True
                if now - connected_at > 2 + args.record_seconds and not stopped:
                    device.write(b'record\n')
                    stopped = True
            if args.status and now >= next_status:
                device.write(b'status\n')
                next_status = now + 10
            data = device.read(8192)
            if data:
                pending_output += data
                while b'\n' in pending_output:
                    line, pending_output = pending_output.split(b'\n', 1)
                    if b'HS_BLE_PRIVATE ' in line:
                        if args.ble_private_file:
                            try:
                                private = json.loads(line.split(b'HS_BLE_PRIVATE ', 1)[1])
                                if not re.fullmatch(r'FreshMate-[0-9A-F]{4}', private.get('name', '')) or not re.fullmatch(r'[0-9a-f]{16}', private.get('proof', '')):
                                    raise ValueError('配网信息格式无效')
                                path = Path(args.ble_private_file)
                                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
                                os.fchmod(fd, 0o600)
                                with os.fdopen(fd, 'w') as file: json.dump(private, file)
                            except Exception:
                                print('未能保存私密BLE信息，内容已隐藏。', flush=True)
                        line = b'[BLE private data redacted]'
                    sys.stdout.buffer.write(line + b'\n')
                sys.stdout.buffer.flush()
        except serial.SerialException:
            device.close()
            device = None
            pending_output = b''
            print('\n串口已断开，此前日志已保留。', flush=True)
            if not args.reconnect:
                break
finally:
    if device is not None:
        device.close()
