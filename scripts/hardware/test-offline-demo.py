#!/usr/bin/env python3
"""真实 UART 验证六场景：检查板上音频写入、字幕进度及开门事件；不能替代现场听音。"""
import argparse, time, re
from pathlib import Path
import serial
from serial.tools import list_ports
from dotenv import dotenv_values
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--log',default='/tmp/freshmate-demo-hardware.log')
a=p.parse_args()
config=dotenv_values(Path(__file__).resolve().parents[2]/'data/hardware/device.env',interpolate=False)
ports=[v.device for v in list_ports.comports() if v.serial_number==config['USB_SERIAL'] and v.vid==0x10c4 and v.pid==0xea60]
assert len(ports)==1,'未发现唯一匹配目标'
s=serial.Serial();s.port=ports[0];s.baudrate=115200;s.timeout=.2;s.dtr=False;s.rts=False;s.open()
log=open(a.log,'w');buffer=''
def wait(pattern,timeout=25):
 global buffer
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  v=s.read(4096).decode('utf-8',errors='replace');log.write(v);log.flush();buffer+=v
  m=re.search(pattern,buffer)
  if m:buffer=buffer[m.end():];return m
 raise AssertionError(f'等待超时：{pattern}；请检查 {a.log}')
def send(cmd):
 global buffer
 pending=s.read(s.in_waiting).decode('utf-8',errors='replace');log.write(pending);log.flush()
 buffer='';s.write((cmd+'\n').encode());s.flush()
try:
 s.rts=True;time.sleep(.1);s.rts=False
 wait('LCD page=0',40)
 send('demo-next');wait('LCD page=1')
 counts=[2,1,4,2,3,2]
 for scene,n in enumerate(counts,1):
  send('demo-next');wait(f'LCD page=2 scene={scene} step=1')
  for step in range(n):
   send('demo-door' if scene in (2,3) else 'demo-next')
   m=wait(r'DEMO_AUDIO bytes=(\d+)/(\d+) result=ESP_OK cancelled=0')
   assert m[1]==m[2] and int(m[1])>0
   wait(f'LCD page=2 scene={scene} step={step+2}')
   if scene in (2,3):time.sleep(2.6)
   else:time.sleep(.1)
  print(f'场景 {scene:02}：{n} 条音频完整写入，字幕进度通过',flush=True)
  send('demo-back');wait('LCD page=1')
  if scene<6:send('demo-up');wait(f'scene={scene+1}')
 # 重播与播放中退出，确保不把旧音频的完成结果推进新场景。
 send('demo-next');wait('LCD page=2 scene=6 step=1')
 send('demo-next');time.sleep(.3);send('demo-back')
 wait('cancelled=1');wait('LCD page=1')
 send('demo-next');wait('LCD page=2 scene=6 step=1')
 send('demo-next');wait(r'DEMO_AUDIO bytes=(\d+)/(\d+) result=ESP_OK cancelled=0');wait('scene=6 step=2')
 send('demo-back');wait('LCD page=1')
 send('demo-back');wait('LCD page=0')
 log.flush()
 evidence=Path(a.log).read_text()
 assert evidence.count('DOOR_OPEN source=DemoButtonDoorSource')==5
 assert evidence.count('DOOR_CLOSE source=DemoButtonDoorSource')==5
 assert '网络已暂停' in evidence and 'Core heartbeat' not in evidence
 # 当前固件先初始化网络以支持全局设置，再暂停；离线演示不连接业务后台。
 print('六场景、重播、播放中退出和返回主页通过。扬声器听感、LCD像素及物理按钮需现场人工确认。',flush=True)
finally:s.close();log.close()
