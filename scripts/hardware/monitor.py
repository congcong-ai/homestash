#!/usr/bin/env python3
"""监听指定开发板；可选跨拔电重连、查询状态或触发录音。"""
import argparse
import sys
import time
from pathlib import Path
import serial
from serial.tools import list_ports
from dotenv import dotenv_values

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--seconds', type=int, default=40)
parser.add_argument('--reset', action='store_true')
parser.add_argument('--record-seconds', type=float)
parser.add_argument('--reconnect', action='store_true')
parser.add_argument('--status', action='store_true')
args = parser.parse_args()
config = dotenv_values(Path(__file__).resolve().parents[2] / 'data/hardware/device.env', interpolate=False)
deadline = time.monotonic() + args.seconds
device = None
connected_at = next_status = 0
sent = stopped = did_reset = False
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
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        except serial.SerialException:
            device.close()
            device = None
            print('\n串口已断开，此前日志已保留。', flush=True)
            if not args.reconnect:
                break
finally:
    if device is not None:
        device.close()
