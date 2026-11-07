#!/usr/bin/env python3
"""创建仅含审计白名单的 IMU 基线包；不连接设备或启动构建。"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
FILES = (
    'firmware/targets.json',
    'firmware/boards/tuya-t5-ai/src/hs_imu_probe.c',
    'firmware/shared/components/device_port/include/hs_runtime.h',
    'firmware/shared/components/device_port/include/hs_error.h',
    'tests/firmware/imu-probe.c',
    'tests/firmware/imu-mocks/tkl_gpio.h',
    'scripts/hardware/imu-lab/snapshot.py',
    'scripts/hardware/imu-lab/verify-host.py',
    'docs/common/project/food-spirit-yard-v1.1/31-remote-imu-lab.md',
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_sources():
    result = {}
    for name in FILES:
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.resolve() != path:
            raise ValueError('白名单路径不存在或包含符号链接：' + name)
        result[name] = path.read_bytes()
    return result


def verify(archive):
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)) or set(names) != set(FILES) | {'manifest.json'}:
            raise ValueError('归档文件清单不符')
        if any(not m.isfile() or m.size > 2_000_000 for m in members):
            raise ValueError('归档含非普通文件或超限内容')
        manifest = json.load(tar.extractfile('manifest.json'))
        if set(manifest['files']) != set(FILES):
            raise ValueError('摘要清单不符')
        for name in FILES:
            if digest(tar.extractfile(name).read()) != manifest['files'][name]:
                raise ValueError('摘要不匹配：' + name)
    print(json.dumps({'校验': '通过', '文件数': len(FILES),
                      'base_commit': manifest['base_commit'],
                      'archive_sha256': digest(Path(archive).read_bytes())}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        verify(args.archive)
        return
    sources = read_sources()
    base = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    manifest = {'schema': 1, 'base_commit': base, 'baseline': '当前工作树白名单，包含未提交内容',
                'purpose': '主机回归与历史代码审阅；不是可刷写固件',
                'files': {name: digest(data) for name, data in sources.items()}}
    if sources != read_sources():
        raise ValueError('采集期间源码变化，请重试')
    # 独占创建，绝不覆盖旧包；不递归打包目录。
    with args.archive.open('xb') as output:
        with tarfile.open(fileobj=output, mode='w:gz') as tar:
            for name, data in {**sources, 'manifest.json': json.dumps(manifest, ensure_ascii=False, indent=2).encode()}.items():
                info = tarfile.TarInfo(name)
                info.size, info.mode = len(data), 0o644
                tar.addfile(info, io.BytesIO(data))
    verify(args.archive)


if __name__ == '__main__':
    main()
