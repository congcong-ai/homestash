#!/usr/bin/env python3
"""只读诊断 T5 下载链路：握手、芯片信息、4KB读取与校验；无擦除和写Flash动作。"""
import argparse
import hashlib
import json
from pathlib import Path
import signal
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tool-root', required=True, help='已安装原厂 tyutool 源码目录')
    parser.add_argument('--port', required=True, help='已核实的 T5 下载串口')
    parser.add_argument('--baud', type=int, default=460800, choices=[115200, 460800, 921600])
    parser.add_argument('--timeout', type=int, default=90, help='全过程时限，单位秒')
    args = parser.parse_args()
    if not (Path(args.tool_root) / 'tyutool/flash/t5/t5_flash.py').is_file():
        parser.error('原厂工具目录无效')
    sys.path.insert(0, args.tool_root)
    from tyutool.flash import FlashArgv
    from tyutool.flash.t5.t5_flash import T5FlashHandler

    def deadline(_signum, _frame):
        raise TimeoutError('只读诊断超时，未执行Flash擦写')

    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(args.timeout)
    handler = T5FlashHandler(FlashArgv('read', 'T5AI', args.port, args.baud, 0, 'unused.bin'))
    started = time.monotonic()
    original = handler.ser_handle.write_cmd_and_wait_response

    def measured(cmd, expect_length, timeout_sec=0.1):
        # 115200 下4KB本身约需0.36秒；原工具0.5秒预算过紧。保持完整协议/CRC验证。
        budget = max(timeout_sec, 2.0) if expect_length >= 4096 else timeout_sec
        begin = time.monotonic()
        ok, data = original(cmd, expect_length, budget)
        if expect_length >= 4096:
            print(json.dumps({'阶段': '读取响应', '期望字节': expect_length, '收到字节': len(data),
                              '耗时毫秒': round((time.monotonic() - begin) * 1000), '完整': ok}, ensure_ascii=False), flush=True)
        return ok, data

    handler.ser_handle.write_cmd_and_wait_response = measured
    try:
        print('只读诊断开始，等待下载握手；不会擦除或写入Flash。', flush=True)
        if not handler.shake():
            raise RuntimeError('下载握手失败')
        print(json.dumps({'阶段': '握手成功', 'FlashID': hex(handler._flash_mid),
                          'Flash容量位': handler._flash_cfg.flash_size, '波特率': args.baud}, ensure_ascii=False), flush=True)
        block = handler.ser_handle.read_and_check_sector(0, handler._flash_cfg.flash_size, recnt=2)
        if block is None:
            raise RuntimeError('首个4KB读取或CRC验证失败')
        print(json.dumps({'阶段': '只读验证通过', '字节数': len(block), 'sha256': hashlib.sha256(block).hexdigest(),
                          '总耗时秒': round(time.monotonic() - started, 2)}, ensure_ascii=False), flush=True)
        handler.reboot()
    finally:
        signal.alarm(0)
        handler.serial_close()


if __name__ == '__main__':
    main()
