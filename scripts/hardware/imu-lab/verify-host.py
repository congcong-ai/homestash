#!/usr/bin/env python3
"""仅运行 IMU 主机 C 回归，无需 Node、SDK 或串口。"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='homestash-imu-host-') as tmp:
    binary = str(Path(tmp) / 'imu-probe')
    subprocess.run(['cc', '-Wall', '-Wextra', '-Werror',
                    '-Itests/firmware/imu-mocks',
                    '-Ifirmware/shared/components/device_port/include',
                    'tests/firmware/imu-probe.c', '-o', binary], cwd=root, check=True)
    subprocess.run([binary], check=True)
print('主机协议回归通过；不代表第二块板身份、采样或门动作通过。')
