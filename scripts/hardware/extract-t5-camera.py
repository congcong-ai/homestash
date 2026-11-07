#!/usr/bin/env python3
"""从私有 T5 诊断日志提取照片，严格校验长度、CRC32 与 JPEG 边界。"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zlib


def extract(log: str) -> bytes:
    matches = list(re.finditer(r'USB照片: BEGIN bytes=(\d+) crc32=([0-9a-f]{8})', log))
    if len(matches) != 1:
        raise ValueError('日志必须包含且仅包含一张带 CRC32 的照片')
    begin = matches[0]
    section = log[begin.end():]
    if 'USB照片: END' not in section:
        raise ValueError('照片传输未结束')
    section = section.split('USB照片: END', 1)[0]
    data = bytes.fromhex(''.join(re.findall(r'USB照片: DATA ([0-9a-f]+)', section)))
    if len(data) != int(begin.group(1)) or zlib.crc32(data) != int(begin.group(2), 16):
        raise ValueError('照片长度或 CRC32 不符，拒绝输出损坏文件')
    if not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
        raise ValueError('JPEG 边界无效')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    data = extract(args.log.read_text(errors='replace'))
    # 不覆盖现有照片；校验通过后才创建输出文件。
    with args.output.open('xb') as target:
        args.output.chmod(0o600)
        target.write(data)
    print(json.dumps({'output': str(args.output.resolve()), 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
