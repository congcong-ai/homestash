#!/usr/bin/env python3
"""准备已锁定、已真机验证的BLE依赖本地副本；共享SDK只读。"""
from pathlib import Path
import hashlib, json, os, shutil, subprocess, tarfile

root = Path(__file__).resolve().parents[2]
sdk = Path(os.environ.get('HOMESTASH_IDF_PATH', Path.home() / 'esp/esp-idf-smartbadge'))
assert subprocess.check_output(['git', '-C', str(sdk), 'rev-parse', 'HEAD'], text=True).strip() == 'ab95e70748f2eddac6f87217b0cf62533684a6ba'
target = root / 'data/hardware/esp-idf-ble-components'
target.mkdir(parents=True, exist_ok=True)
libraries = [
    ('bt', 'controller/lib_esp32s31/esp32s31-bt-lib', 'esp32s31-bt-lib', 'cc027ecd288b31198f82331faabb972a37d6800e', 'f95851bf72da02b929f2c120306a58275b844a3275eee94b5af39bf4d876ff19', root / 'data/hardware/retest-20261019/bt-lib.tar.gz'),
    ('protobuf-c', 'protobuf-c', 'protobuf-c', 'abc67a11c6db271bedbb9f58be85d6f4e2ea8389', '6f41b467d7b7242bb201f6466ba433f6eab943e2b6fc53bb753340632c9e45e2', root / 'data/hardware/ble-usb-20261020/protobuf-c.tar.gz'),
]
for component, subdir, repository, commit, expected, previous in libraries:
    archive = target / (repository + '.tar.gz')
    if not archive.exists():
        if previous.exists(): shutil.copyfile(previous, archive)
        else:
            owner = 'espressif' if component == 'bt' else 'protobuf-c'
            subprocess.run(['curl', '-fL', '--retry', '2', '--max-time', '90', f'https://codeload.github.com/{owner}/{repository}/tar.gz/{commit}', '-o', str(archive)], check=True)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, '依赖归档摘要不符，已停止'
    destination = target / component
    marker = target / (component + '.ready.json')
    if marker.exists() and json.loads(marker.read_text()).get('sha256') == expected:
        continue
    if destination.exists(): shutil.rmtree(destination)
    shutil.copytree(sdk / 'components' / component, destination, symlinks=True)
    library = destination / subdir
    if library.exists(): shutil.rmtree(library)
    library.mkdir(parents=True)
    with tarfile.open(archive) as compressed:
        for member in compressed.getmembers():
            parts = Path(member.name).parts[1:]
            if not parts: continue
            assert '..' not in parts and not member.issym() and not member.islnk()
            member.name = str(Path(*parts))
            compressed.extract(member, library, filter='data')
    marker.write_text(json.dumps({'sdk': 'ab95e70748f2eddac6f87217b0cf62533684a6ba', 'commit': commit, 'sha256': expected}) + '\n')
print('BLE控制器及protobuf-c锁定依赖已就绪；未修改共享SDK。')
