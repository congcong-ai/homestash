#!/usr/bin/env python3
"""将16kHz单声道WAV送入板上真实模型，验证六场景识别、播报和续接；不代替麦克风现场验收。"""
import argparse
import json
import re
import time
from pathlib import Path

import serial
from serial.tools import list_ports
from dotenv import dotenv_values

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--base-url', required=True, help='开发板可访问的WAV目录HTTP地址')
p.add_argument('--log', default='/tmp/homestash-online-demo-uart.log')
a = p.parse_args()
assert a.base_url.startswith('http://'), '测试录音服务需使用HTTP'
config = dotenv_values(Path(__file__).resolve().parents[2] / 'data/hardware/device.env', interpolate=False)
ports = [v.device for v in list_ports.comports() if v.serial_number == config['USB_SERIAL'] and v.vid == 0x10c4 and v.pid == 0xea60]
assert len(ports) == 1, '未发现唯一匹配的目标板'
s = serial.Serial()
s.port, s.baudrate, s.timeout, s.dtr, s.rts = ports[0], 115200, .1, False, False
s.open()
log = open(a.log, 'w')
buffer = ''


def wait(pattern, timeout=45):
    global buffer
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        v = s.read(8192).decode(errors='replace')
        buffer += v
        log.write(v)
        log.flush()
        m = re.search(pattern, buffer)
        if m:
            buffer = buffer[m.end():]
            return m
    raise AssertionError(f'等待超时：{pattern}；检查 {a.log}')


def send(command):
    # UART逐字节发送，避免固件stdio输入队列溢出。
    for b in (command + '\n').encode():
        s.write(bytes([b]))
        s.flush()
        time.sleep(.006)


def probe(name, expected, context, route=False):
    send('voice-probe ' + json.dumps(dict(url=f'{a.base_url.rstrip("/")}/{name}.wav', awake=name != 'wake', context=context, route=route)))
    m = wait(r'VOICE_PROBE result=(\d+) bytes=\d+')
    assert int(m[1]) == expected, f'{name}：期待{expected}，实际{m[1]}'
    if route:
        wait(fr'VOICE scene=\d+ step=\d+ got={expected} ')


def playback(scene, next_step):
    m = wait(r'DEMO_AUDIO bytes=(\d+)/(\d+) result=ESP_OK cancelled=0')
    assert m[1] == m[2] and int(m[1]) > 0, '音频未完整写入'
    wait(fr'LCD page=2 scene={scene} step={next_step} playing=0')


try:
    s.rts = True
    time.sleep(.1)
    s.rts = False
    wait('本地唤醒与固定指令就绪')
    wait('LCD page=0')
    send('demo-online')
    wait('LCD page=1')
    for attempt in range(24):
        if attempt in (8, 16):
            send('wifi-reconnect')
        send('wifi-status')
        if wait(r'Wi-Fi connected=(\d)', 10)[1] == '1':
            break
        time.sleep(3)
    else:
        raise AssertionError('Wi-Fi未连接，无法取得测试录音')

    # 先独立覆盖每个提示词和常用变体，使用生产默认阈值，不注入指令答案。
    for name, expected in [('wake', 100), ('eggs', 1), ('door', 9), ('strawberry', 7), ('why', 2), ('dinner', 3), ('dinner_name', 3), ('start', 4), ('start_full', 4), ('next', 5), ('battery', 8), ('charge', 6), ('charge_short', 6), ('dismiss', 10)]:
        probe(name, expected, 0 if expected == 100 else expected)
    print('14段录音在板上真实模型识别通过', flush=True)

    steps = [[('eggs', 1)], [('door', 9)], [('door', 9)] * 4, [('why', 2)], [('dinner', 3), ('start', 4), ('next', 5)], [('charge', 6)]]
    for scene, commands in enumerate(steps, 1):
        send('demo-next')
        wait(fr'LCD page=2 scene={scene} step=1 playing=0')
        probe('wake', 100, 0, True)
        if scene in (1, 4, 6):
            playback(scene, 2)
        else:
            wait(fr'LCD page=2 scene={scene} step=1 playing=0')
        for index, (name, command) in enumerate(commands):
            probe(name, command, command, True)
            playback(scene, index + (3 if scene in (1, 4, 6) else 2))
            if scene == 3:
                time.sleep(2.6)
        probe('dismiss', 10, 10, True)
        wait('已结束唤醒')
        print(f'场景{scene:02}：唤醒、连续指令、完整播报及退下通过', flush=True)
        send('demo-back')
        wait('LCD page=1')
        if scene < 6:
            send('demo-up')
            wait(fr'LCD page=1 scene={scene + 1}')
    # 专门回归用户报告的换场景后绿色已唤醒却不接话：04→05→06只唤醒一次。
    for scene in (5, 4):
        send('demo-down')
        wait(fr'LCD page=1 scene={scene}')
    for scene in (4, 5, 6):
        send('demo-next')
        wait(fr'LCD page=2 scene={scene} step=1 playing=0')
        if scene == 4:
            probe('wake', 100, 0, True)
        if scene in (4, 6):
            playback(scene, 2)
        for index, (name, command) in enumerate(steps[scene - 1]):
            probe(name, command, command, True)
            playback(scene, index + (3 if scene in (4, 6) else 2))
        send('demo-back')
        wait('LCD page=1')
        if scene < 6:
            send('demo-up')
            wait(fr'LCD page=1 scene={scene + 1}')
    print('04→05→06保持唤醒换场景、连续接话通过', flush=True)
    evidence = Path(a.log).read_text()
    assert 'Guru Meditation' not in evidence and 'panic' not in evidence, '观察到崩溃'
    print('六场景真实模型与控制流程通过；仍需现场麦克风、LCD及听感验收。', flush=True)
finally:
    s.close()
    log.close()
