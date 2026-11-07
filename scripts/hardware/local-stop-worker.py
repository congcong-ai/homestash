"""仅在主机本地识别插话短指令，模型预载；不接收远程命令或路径。"""
import base64, io, json, sys
import numpy as np
import mlx_whisper
model = sys.argv[1]
# 预载模型并执行一次静音推理，不下载模型，不将音频发到网络。
mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=model, language='zh', temperature=0, condition_on_previous_text=False)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        data = base64.b64decode(request['wav'], validate=True)
        import wave
        with wave.open(io.BytesIO(data)) as f:
            if f.getframerate()!=16000 or f.getnchannels()!=1 or f.getsampwidth()!=2 or f.getnframes()>16000*8:
                raise ValueError('format')
            samples = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32)/32768
        result = mlx_whisper.transcribe(samples,path_or_hf_repo=model,language='zh',temperature=0,condition_on_previous_text=False)
        print(json.dumps({'id':request['id'],'text':result['text']},ensure_ascii=False),flush=True)
    except Exception:
        print(json.dumps({'id':request.get('id') if isinstance(locals().get('request'),dict) else None,'error':'本地短指令识别失败'}),flush=True)
