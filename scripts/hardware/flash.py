#!/usr/bin/env python3
"""验证设备身份、完整备份与镜像范围后烧录；不擦除 NVS 和 SD。"""
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path
from serial.tools import list_ports
from dotenv import dotenv_values
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--backup',required=True,help='已核验备份的 manifest.json 绝对路径')
p.add_argument('--dry-run',action='store_true')
p.add_argument('--baud',type=int,choices=[115200,230400,460800],default=230400,help='串口速率，链路不稳时降低')
p.add_argument('--wait-seconds',type=int,default=0,help='等待已配置的唯一目标 UART 重新出现，最多 600 秒')
a=p.parse_args()
root=Path(__file__).resolve().parents[2];build=root/'firmware/freshmate-korvo/build'
config=dotenv_values(root/'data/hardware/device.env',interpolate=False)
manifest_path=Path(a.backup).resolve();manifest=json.loads(manifest_path.read_text())
backup=(manifest_path.parent/manifest['file']).resolve()
assert backup.parent==manifest_path.parent and manifest['verifiedAgainstFlash']
assert backup.stat().st_size==manifest['bytes']==0x1000000
assert hashlib.sha256(backup.read_bytes()).hexdigest()==manifest['sha256']
assert manifest['mac']==config['DEVICE_MAC'] and manifest['usbSerial']==config['USB_SERIAL']
files=json.loads((build/'flasher_args.json').read_text())['flash_files']
assert {int(k,0) for k in files}=={0x2000,0x8000,0x10000}
args=[]
for offset,name in sorted(files.items(),key=lambda x:int(x[0],0)):
 f=(build/name).resolve();assert f.is_relative_to(build) and f.is_file()
 assert int(offset,0)+f.stat().st_size<0x410000
 args.extend([offset,str(f)])
if a.dry_run:
 print('镜像与完整备份验证通过；未打开串口、未烧录。');sys.exit(0)
assert 0<=a.wait_seconds<=600
end=time.monotonic()+a.wait_seconds
if a.wait_seconds: print('等待已配置的唯一目标 UART；不会选择其它设备。',flush=True)
while True:
 ports=[p.device for p in list_ports.comports() if p.serial_number==config['USB_SERIAL'] and p.vid==0x10c4 and p.pid==0xea60]
 if len(ports)==1:break
 assert len(ports)<2,'存在多个匹配目标，禁止烧录'
 assert time.monotonic()<end,'未发现唯一匹配的开发板'
 time.sleep(.5)
base=[sys.executable,'-m','esptool','--chip','esp32s31','--port',ports[0],'--baud',str(a.baud),'--no-stub']
identity=subprocess.check_output(base+['--after','no-reset','read-mac'],text=True)
assert f"MAC:                {config['DEVICE_MAC']}" in identity,'MAC 验证失败'
subprocess.run(base+['write-flash','--flash-mode','dio','--flash-size','16MB','--flash-freq','80m']+args,check=True)
print('写入和 esptool 校验完成，接下来必须检查启动、联网和音频。')
