#!/usr/bin/env python3
"""验证公共层边界及真实能力策略；两种主机板型配置不代表第二块物理板已适配。"""
from pathlib import Path
import subprocess,tempfile,re
root=Path(__file__).resolve().parents[2]
common=root/'firmware/common/components'
for file in list(common.rglob('*.c'))+list((root/'firmware/apps').rglob('*.c')):
    source=file.read_text()
    assert not re.search(r'#include\s+[<"](?:bsp/|driver/gpio|lvgl|esp_lv_adapter)',source),f'公共组件依赖板级实现：{file}'
    assert '/sdcard/' not in source,f'公共组件写死挂载点：{file}'
with tempfile.TemporaryDirectory(prefix='homestash-device-ports-') as directory:
    tmp=Path(directory);(tmp/'esp_err.h').write_text('typedef int esp_err_t;\n')
    (tmp/'test.c').write_text(r'''
#include <assert.h>
#include <stdio.h>
#include "hs_device_policy.h"
int main(void){
 hs_board_descriptor_t full={.id="host-full",.chip="host",.capabilities=0x7ff};
 hs_board_descriptor_t minimal={.id="host-voice",.chip="host",.capabilities=HS_CAP_AUDIO_INPUT|HS_CAP_AUDIO_OUTPUT|HS_CAP_WIFI|HS_CAP_OTA|HS_CAP_PERSISTENT_STORAGE};
 assert(hs_device_action_supported(&full,HS_ACTION_PHOTO));
 assert(hs_device_action_supported(&full,HS_ACTION_PROVISION_START));
 assert(hs_device_action_supported(&minimal,HS_ACTION_VOICE_TOGGLE));
 assert(hs_device_action_supported(&minimal,HS_ACTION_OTA_INSTALL));
 assert(!hs_device_action_supported(&minimal,HS_ACTION_PHOTO));
 assert(!hs_device_action_supported(&minimal,HS_ACTION_PROVISION_START));
 assert(!hs_device_action_supported(&minimal,HS_ACTION_SLEEP_DEEP));
 minimal.capabilities &= ~HS_CAP_PERSISTENT_STORAGE;
 assert(!hs_device_action_supported(&minimal,HS_ACTION_VOICE_TOGGLE));
 assert(!hs_device_action_supported(NULL,HS_ACTION_VOICE_TOGGLE));
 puts("通过：公共代码无BSP/LVGL/GPIO/挂载点依赖；全能力和精简语音配置复用同一策略，缺失能力明确拒绝。");
}
''')
    port=common/'device_port'
    subprocess.run(['cc','-fsanitize=address,undefined','-I',str(tmp),'-I',str(port/'include'),str(port/'hs_device_policy.c'),str(tmp/'test.c'),'-o',str(tmp/'test')],check=True)
    subprocess.run([str(tmp/'test')],check=True)
