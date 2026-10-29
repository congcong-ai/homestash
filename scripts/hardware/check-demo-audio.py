#!/usr/bin/env python3
"""验证14条自然配音与固件 IMA 解码器，临时产物不写项目目录。"""
from pathlib import Path
import array,hashlib,json,struct,subprocess,tempfile,wave
root=Path(__file__).resolve().parents[2]
audio=root/'firmware/freshmate-korvo/assets/audio'
manifest=json.loads((audio/'manifest.json').read_text())
assert len(manifest['entries'])==14
with tempfile.TemporaryDirectory(prefix='freshmate-audio-test-') as directory:
 tmp=Path(directory)
 component=root/'firmware/freshmate-korvo/components/audio'
 subprocess.run(['cc','-Wall','-Wextra','-Werror','-I',str(component/'include'),str(component/'demo_adpcm.c'),str(root/'tests/firmware/offline-demo-adpcm.c'),'-o',str(tmp/'decode')],check=True)
 for entry in manifest['entries']:
  source=audio/(entry['name']+'.wav')
  assert hashlib.sha256(source.read_bytes()).hexdigest()==entry['sha256']
  with wave.open(str(source)) as f:assert (f.getnchannels(),f.getsampwidth(),f.getframerate())==(1,2,16000)
  subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-c:a','adpcm_ima_wav','-block_size','256',str(tmp/'encoded.wav')],check=True)
  data=(tmp/'encoded.wav').read_bytes();pos=12
  while pos+8<=len(data):
   tag=data[pos:pos+4];size=struct.unpack_from('<I',data,pos+4)[0]
   if tag==b'data':(tmp/'blocks.bin').write_bytes(data[pos+8:pos+8+size]);break
   pos+=8+size+(size%2)
  else:raise AssertionError('无IMA数据')
  subprocess.run([str(tmp/'decode'),str(tmp/'blocks.bin'),str(tmp/'actual.pcm')],check=True)
  subprocess.run(['ffmpeg','-v','error','-y','-i',str(tmp/'encoded.wav'),'-f','s16le',str(tmp/'expected.pcm')],check=True)
  assert (tmp/'actual.pcm').read_bytes()==(tmp/'expected.pcm').read_bytes(),entry['name']
  print(entry['name']+'：摘要、格式、固件解码与FFmpeg逐样本一致')
