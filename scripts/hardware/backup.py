#!/usr/bin/env python3
"""只读整片 Flash 备份；逐块摘要验证，断点可恢复，备份包含设备配置。"""
import argparse, hashlib, json, os
from pathlib import Path
import esptool
from serial.tools import list_ports
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory',required=True)
p.add_argument('--usb-serial',required=True)
p.add_argument('--mac',required=True)
p.add_argument('--filename',default='homestash-full-16mb.bin')
a=p.parse_args()
os.umask(0o077)
d=Path(a.directory).resolve();d.mkdir(parents=True,exist_ok=True)
ports=[p.device for p in list_ports.comports() if p.serial_number==a.usb_serial and p.vid==0x10c4 and p.pid==0xea60]
assert len(ports)==1,'未发现唯一匹配的开发板'
esp=esptool.detect_chip(ports[0])
assert esp.CHIP_NAME=='ESP32-S31'
mac=':'.join(f'{x:02x}' for x in esp.read_mac());assert mac==a.mac,'MAC 不匹配'
esp=esp.run_stub();esp.change_baud(230400)
esptool.attach_flash(esp);esp.flash_set_parameters(0x1000000)
assert Path(a.filename).name==a.filename and a.filename.endswith('.bin'),'备份文件名必须是 .bin 文件'
file=d/a.filename
chunk_dir=d/'chunks';chunk_dir.mkdir(exist_ok=True)
size=0x10000;blank=b'\xff'*size;blank_md5=hashlib.md5(blank).hexdigest()
with file.open('wb') as f:
 for offset in range(0,0x1000000,size):
  expected=esp.flash_md5sum(offset,size)
  part=chunk_dir/f'{offset:06x}.bin'
  if expected==blank_md5: data=blank
  elif part.exists() and hashlib.md5(part.read_bytes()).hexdigest()==expected: data=part.read_bytes()
  else:
   data=esp.read_flash(offset,size)
   assert len(data)==size and hashlib.md5(data).hexdigest()==expected
   part.write_bytes(data)
  f.write(data)
  print(f'已核验 {offset+size}/{0x1000000} 字节',flush=True)
 f.flush();os.fsync(f.fileno())
assert file.stat().st_size==0x1000000
assert hashlib.md5(file.read_bytes()).hexdigest()==esp.flash_md5sum(0,0x1000000),'整片摘要不匹配'
manifest={'说明':'开发板当前完整 Flash；空白块经设备摘要确认后重建，其余块从设备读取。含配置，禁止上传。','mac':mac,'usbSerial':a.usb_serial,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'verifiedAgainstFlash':True,'file':file.name}
(d/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
esp.hard_reset()
esp._port.close()
print('完整 16 MB 备份与设备整片摘要校验成功。',flush=True)
