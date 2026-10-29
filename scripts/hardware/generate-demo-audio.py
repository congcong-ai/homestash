#!/usr/bin/env python3
"""将已生成的自然配音打包为固件内 IMA ADPCM；不调用系统配音。"""
from pathlib import Path
import json,subprocess,argparse,struct,tempfile,shutil
root=Path(__file__).resolve().parents[2]/'firmware/freshmate-korvo'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,help='generate-demo-voices.ts 生成的完整配音目录')
args=parser.parse_args()
scenes=json.loads((root/'components/demo_mode/scenes.json').read_text())
p=root/'components/demo_mode'
header=['#pragma once','#include <stddef.h>','typedef struct { const char *cue,*reply; const signed char *pcm; size_t bytes; } demo_step_t;','typedef struct {const char *title,*seed; int count; const demo_step_t *steps;} demo_scene_t;','extern const demo_scene_t demo_scenes[6];']
(p/'include/demo_scenes.h').write_text('\n'.join(header)+'\n')
c=['#include "demo_scenes.h"']
for i,(title,steps) in enumerate(scenes):
 for j,(cue,reply) in enumerate(steps):
  name=f'demo{i+1:02}_{j+1:02}'; wav=root/'assets/audio'/f'{name}.wav'
  if args.source_dir:
   shutil.copyfile(args.source_dir/f'{name}.wav',wav)
  if not wav.is_file():raise RuntimeError(f'缺少自然配音 {wav}')
  with tempfile.TemporaryDirectory(prefix='freshmate-adpcm-') as tmp:
   encoded=Path(tmp)/'clip.wav'
   subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-ac','1','-ar','16000','-c:a','adpcm_ima_wav','-block_size','256',str(encoded)],check=True)
   data=encoded.read_bytes();pos=12;raw=None
   while pos+8<=len(data):
    tag=data[pos:pos+4];size=struct.unpack_from('<I',data,pos+4)[0]
    if tag==b'data':raw=data[pos+8:pos+8+size];break
    pos+=8+size+(size%2)
   if not raw or len(raw)%256:raise RuntimeError('IMA音频数据无效')
  c.append(f'static const signed char {name}[]={{'+','.join(str(b if b<128 else b-256) for b in raw)+'};')
 c.append(f'static const demo_step_t steps{i}[]={{')
 for j,(cue,reply) in enumerate(steps):
  name=f'demo{i+1:02}_{j+1:02}'
  c.append('{'+json.dumps(cue,ensure_ascii=False)+','+json.dumps(reply,ensure_ascii=False)+f',{name},sizeof({name})'+'},')
 c.append('};')
seeds=['演示库存：鸡蛋 6 颗','演示事件，不连接门磁','演示：10 分钟内开门 4 次','演示库存：草莓 1 盒，请检查新鲜度','演示菜谱：番茄鸡蛋面','模拟低电量，不读取真实电池']
c.append('const demo_scene_t demo_scenes[6]={')
for i,(title,steps) in enumerate(scenes):c.append('{'+json.dumps(title,ensure_ascii=False)+','+json.dumps(seeds[i],ensure_ascii=False)+f',{len(steps)},steps{i}'+'},')
c.append('};')
(p/'demo_scenes.c').write_text('\n'.join(c)+'\n')

if args.source_dir:
 shutil.copyfile(args.source_dir/'manifest.json',root/'assets/audio/manifest.json')
print('14条自然配音已打包为16 kHz IMA ADPCM。')
