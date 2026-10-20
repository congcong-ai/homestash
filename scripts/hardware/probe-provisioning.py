#!/usr/bin/env python3
"""用乐鑫官方协议测试 BLE 加密配网；凭据从本机忽略文件读取，不放进命令行或日志。"""
import asyncio
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / 'data/hardware/ble-usb-20261020'
sys.path.insert(0, str(LAB / 'python'))
sys.path.insert(0, str(LAB / 'upstream/network_provisioning/tool/esp_prov'))
os.environ.setdefault('IDF_PATH', '/Users/peter/esp/esp-idf-smartbadge')
from dotenv import dotenv_values
import esp_prov
from bleak import BleakScanner
from bleak.exc import BleakGATTProtocolError

# macOS 会保留同一硬件以前的名称；匹配当前广播名称，保留官方协议实现。
_discover = BleakScanner.discover
async def discover_current_name(*args, **kwargs):
    found = await _discover(*args, **kwargs)
    if kwargs.get('return_adv'):
        targets = [(d, a) for d, a in found.values() if a.local_name == 'HS-Provision-Test']
        if len(targets) > 1:
            raise RuntimeError('发现多个同名配网目标，已停止')
        for device, advertisement in targets:
            if device.name != advertisement.local_name:
                print('Mac 缓存了旧名称，已按当前广播名称匹配目标', flush=True)
                device.name = advertisement.local_name
    return found
BleakScanner.discover = staticmethod(discover_current_name)


async def session(pop):
    transport = await esp_prov.get_transport('ble', 'HS-Provision-Test')
    if transport is None:
        raise RuntimeError('未发现唯一目标配网服务')
    security = esp_prov.get_security(1, 0, None, None, pop=pop, verbose=False)
    return transport, security


async def main():
    private = json.loads((LAB / 'private.json').read_text())
    config = dotenv_values(ROOT / 'data/hardware/device.env', interpolate=False)
    assert config.get('WIFI_SSID') and config.get('WIFI_PASSWORD'), '缺少本地测试网络配置'
    result = {'date': '2026-10-20', 'board': 'ESP32-S31-Korvo-1 V1.1', 'transport': 'BLE', 'security': 'Espressif Security 1'}
    tp, sec = await session('incorrect-test-proof')
    try:
        try:
            accepted = await esp_prov.establish_session(tp, sec)
        except BleakGATTProtocolError as error:
            if int(error.code) != 0x85:
                raise
            accepted = False
            result['incorrectProofAttError'] = '0x85'
        assert not accepted, '错误 PoP 意外建立了会话'
        result['incorrectProofRejected'] = True
        print('通过：错误 PoP 无法建立加密会话，未发送网络凭据', flush=True)
    finally:
        await tp.disconnect()
    await asyncio.sleep(2)
    tp, sec = await session(private['pop'])
    try:
        assert await esp_prov.establish_session(tp, sec), '正确 PoP 建立加密会话失败'
        result['secureSession'] = True
        print('通过：正确 PoP 建立 Security 1 加密会话', flush=True)
        assert await esp_prov.send_wifi_config(tp, sec, config['WIFI_SSID'], config['WIFI_PASSWORD']), '网络配置下发失败'
        result['credentialsSentOverBle'] = True
        print('通过：网络信息经 BLE 加密发送并得到设备确认（不回显内容）', flush=True)
        assert await esp_prov.apply_wifi_config(tp, sec), '应用网络配置失败'
        for _ in range(30):
            await asyncio.sleep(2)
            if await esp_prov.get_wifi_config(tp, sec) == 'connected':
                result['wifiConnectedReportedOverBle'] = True
                print('通过：BLE 配网状态确认 Wi-Fi 已连接；需再核对串口 IP 与重启持久化', flush=True)
                break
        else:
            raise RuntimeError('60 秒内未通过 BLE 确认联网成功')
    finally:
        await tp.disconnect()
    output = LAB / 'provision-client-result.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    output.chmod(0o600)


if __name__ == '__main__':
    asyncio.run(main())
