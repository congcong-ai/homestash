#!/usr/bin/env python3
"""FreshMate产品BLE配置客户端；复用乐鑫Security 1，凭据不进入命令行和日志。"""
import argparse, asyncio, getpass, json, os, sys, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / 'data/hardware/ble-usb-20261020'
sys.path.insert(0, str(LAB / 'python'))
sys.path.insert(0, str(ROOT / 'data/hardware/python-ble'))
sys.path.insert(0, str(ROOT / 'vendor/espressif/protocomm-client'))
os.environ.setdefault('IDF_PATH', str(Path.home() / 'esp/esp-idf-smartbadge'))
from dotenv import dotenv_values
from bleak import BleakScanner, BleakClient
from bleak.exc import BleakGATTProtocolError
from security.security1 import Security1

SERVICE = '48535000-6b15-26aa-be42-9a4167384621'
SESSION = '4853ff51-6b15-26aa-be42-9a4167384621'
CONFIG = '4853ff52-6b15-26aa-be42-9a4167384621'

async def exchange(client, characteristic, data):
    await client.write_gatt_char(characteristic, data, response=True)
    return bytes(await client.read_gatt_char(characteristic))

async def establish(client, proof):
    security = Security1(proof, False)
    reply = None
    while True:
        message = security.security_session(reply)
        if message is None: return security
        reply = (await exchange(client, SESSION, message.encode('latin-1'))).decode('latin-1')

def capture(config, output):
    import serial
    from serial.tools import list_ports
    ports = [p.device for p in list_ports.comports() if p.serial_number == config['USB_SERIAL'] and p.vid == 0x10c4 and p.pid == 0xea60]
    if len(ports) != 1: raise RuntimeError('未发现唯一匹配UART；可手动开启LCD蓝牙页并输入验证码')
    device = serial.Serial();device.port = ports[0];device.baudrate = 115200;device.timeout = .3;device.dtr = device.rts = False
    device.open()
    # 串口打开可能复位；等待启动自检完成，不刷写、不擦除配置。
    start = time.monotonic();last = 0
    try:
        while time.monotonic() - start < 85:
            elapsed = time.monotonic() - start
            if elapsed > 38 and elapsed - last > 2:
                device.write(b'ble-start\nble-private\n');last = elapsed
            line = device.readline()
            if b'HS_BLE_PRIVATE ' in line:
                private = json.loads(line.split(b'HS_BLE_PRIVATE ', 1)[1])
                fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, 'w') as file: json.dump(private, file)
                os.chmod(output, 0o600)
                print('已取得本机一次性配网信息并保存到私密文件；不输出验证码。', flush=True)
                return private
            if line:
                with (output.parent / 'uart-public.log').open('ab') as file: file.write(line)
        raise RuntimeError('未能开启配网窗口，请检查是否仍有录音/照片待处理')
    finally: device.close()

async def main(args):
    config = dotenv_values(ROOT / 'data/hardware/device.env', interpolate=False)
    output = Path(args.output);output.parent.mkdir(parents=True, exist_ok=True)
    private_path = output.parent / 'private.json'
    if args.capture_uart: private = capture(config, private_path)
    elif args.private_file:
        path = Path(args.private_file)
        if path.stat().st_mode & 0o077: raise RuntimeError('私密配网文件权限必须为600')
        private = json.loads(path.read_text())
    else: private = {'name': input('LCD显示的设备名：').strip(), 'proof': getpass.getpass('LCD一次性验证码（不回显）：')}
    found = await BleakScanner.discover(timeout=8, return_adv=True, service_uuids=[SERVICE])
    devices = [d for d, advertisement in found.values() if advertisement.local_name == private['name']]
    if len(devices) != 1: raise RuntimeError('未发现唯一匹配的FreshMate配网广播')
    result = {'transport': 'protocomm BLE', 'security': 'Espressif Security 1', 'name': private['name']}
    if args.verify:
        async with BleakClient(devices[0]) as client:
            rejected = False
            try: await establish(client, 'incorrect-proof')
            except BleakGATTProtocolError as error:
                if int(error.code) != 0x85: raise
                rejected = True
            if not rejected: raise RuntimeError('错误PoP未被明确拒绝')
        result['incorrectProofRejected'] = True
        print('通过：错误验证码被拒绝，未发送配置。', flush=True)
        await asyncio.sleep(2)
    async with BleakClient(devices[0]) as client:
        security = await establish(client, private['proof'])
        result['secureSession'] = True
        async def request(data):
            message = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode()
            if len(message) > 480: raise RuntimeError('配置超过单帧480字节限制，当前请使用LCD完成此配置')
            reply = await exchange(client, CONFIG, security.encrypt_data(message))
            return json.loads(security.decrypt_data(reply).decode())
        payload = {'op': 'configure', 'requestId': str(uuid.uuid4()),
                   'wifi': {'ssid': config['WIFI_SSID'], 'password': config.get('WIFI_PASSWORD', ''), 'open': not config.get('WIFI_PASSWORD')},
                   'core': {'url': config['CORE_URL'], 'deviceId': config['DEVICE_ID'], 'token': config['DEVICE_TOKEN']}}
        if args.verify:
            bad = {**payload, 'core': {**payload['core'], 'token': 'invalid'}}
            assert (await request(bad))['state'] == 'rejected'
            result['invalidCoreRejected'] = True
            # 不覆盖已保存网络：先用不存在的SSID覆盖真实失败路径，再提交正常配置。
            unavailable = {**payload, 'requestId': str(uuid.uuid4()),
                           'wifi': {'ssid': 'HS-Unavailable-' + uuid.uuid4().hex[:12],
                                    'password': 'test-only-password', 'open': False}}
            assert (await request(unavailable))['state'] != 'rejected'
            for _ in range(22):
                await asyncio.sleep(2)
                failed = await request({'op': 'status'})
                if failed['state'] == 'failed': break
                if failed['state'] in ('saved', 'partial'):
                    raise RuntimeError('不可用网络意外保存，已停止验收')
            else: raise RuntimeError('不可用网络未在预期时间内返回失败')
            result['unavailableWifiRejected'] = True
            print('通过：不可用网络返回失败，继续验证正确配置。', flush=True)
        first = await request(payload)
        if first['state'] == 'rejected': raise RuntimeError('设备拒绝配置：' + first['message'])
        assert (await request(payload))['state'] != 'rejected'
        if args.verify:
            altered = {**payload, 'wifi': {**payload['wifi'], 'password': 'different-password'}}
            assert (await request(altered))['state'] == 'rejected'
            result['sameIdDifferentPayloadRejected'] = True
        for _ in range(24):
            await asyncio.sleep(2)
            state = await request({'op': 'status'})
            if state['state'] == 'saved': break
            if state['state'] in ('failed', 'partial', 'rejected'): raise RuntimeError('设备未完成全部配置：' + state['message'])
        else: raise RuntimeError('等待设备保存配置超时')
        result.update(wifiAndCoreSaved=True, requestReplayAccepted=True, state=state['state'])
        print('通过：加密配置、Wi-Fi联网并保存、Core字段保存；需再核对窗口关闭和重启。', flush=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file: json.dump(result, file, ensure_ascii=False, indent=2)
    # 不保留已用PoP；重开窗口将生成新验证码。
    if args.capture_uart: private_path.write_text('{}\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-uart', action='store_true', help='按已配置USB身份从本机UART开启并读取一次性信息')
    parser.add_argument('--private-file', help='使用权限600的本机临时配网信息，不通过参数传PoP')
    parser.add_argument('--verify', action='store_true', help='额外验证错误PoP、非法Core、不可用网络和请求重放')
    parser.add_argument('--output', default=str(ROOT / 'data/hardware/freshmate-ble/product-result.json'))
    asyncio.run(main(parser.parse_args()))
