#include "hs_audio.h"
#include "hs_storage.h"
#include "hs_outbox.h"
#include "hs_display.h"
#include "hs_transport.h"
#include "hs_network.h"
#include "wifi_profiles.h"
#include "bsp/button.h"
#include "nvs_flash.h"
#include "esp_random.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
static QueueHandle_t buttons, uploads, results;
typedef struct { int success; char message[1024]; } result_t;
static void button(void *handle,void *arg) { int action=1; xQueueSend(buttons,&action,0); }
static void uuid(char id[37]) {
  unsigned char b[16]; esp_fill_random(b,16); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  snprintf(id,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
static void upload(void *arg) {
  char id[37];
  for(;;) {
    if(!xQueueReceive(uploads,id,pdMS_TO_TICKS(15000))) {
      hs_wifi_status_t status; hs_wifi_status(&status);
      if(status.connected) ESP_LOGI("FreshMate", "Core heartbeat: %s", esp_err_to_name(hs_transport_heartbeat()));
      continue;
    }
    result_t r={0}; hs_wifi_status_t status; hs_wifi_status(&status);
    if(status.connected && hs_transport_capture(id,r.message,sizeof(r.message))==ESP_OK) {
      r.success=hs_transport_reply(id)==ESP_OK?2:1;
    }
    if(!r.success) snprintf(r.message,sizeof(r.message),"上传未完成，录音已保留。按 SET 重试。");
    ESP_LOGI("FreshMate", "capture=%s result=%d", id, r.success);
    xQueueSend(results,&r,portMAX_DELAY);
  }
}
static void console(void *arg) {
  char line[64]; size_t length=0;
  for(;;) {
    int c=getchar();
    if(c==EOF) {vTaskDelay(pdMS_TO_TICKS(20));continue;}
    if(c=='\n' || c=='\r') {
      line[length]=0;
      if(!strcmp(line,"record")) button(NULL,NULL);
      if(!strcmp(line,"status")) {int action=2;xQueueSend(buttons,&action,0);}
      length=0;
    } else if(length<sizeof(line)-1) line[length++]=c;
  }
}
void app_main(void) {
  /* 不擦除既有 NVS，不格式化 SD，也不访问工牌业务目录。 */
  ESP_ERROR_CHECK(nvs_flash_init());
  ESP_ERROR_CHECK(hs_display_init());
  if(hs_storage_init()!=ESP_OK) { hs_display_text("无法挂载存储卡，请检查 microSD。不会自动格式化。"); return; }
  ESP_ERROR_CHECK(hs_audio_init()); ESP_ERROR_CHECK(hs_network_init());
  buttons=xQueueCreate(4,sizeof(int)); uploads=xQueueCreate(1,37); results=xQueueCreate(1,sizeof(result_t));
  configASSERT(buttons && uploads && results);
  configASSERT(xTaskCreate(console,"串口调试",3072,NULL,3,NULL)==pdPASS);
  configASSERT(xTaskCreate(upload,"上传",8192,NULL,4,NULL)==pdPASS);
  button_handle_t handles[BSP_BUTTON_NUM]; ESP_ERROR_CHECK(bsp_iot_button_create(handles,NULL,BSP_BUTTON_NUM));
  ESP_ERROR_CHECK(iot_button_register_cb(handles[BSP_BUTTON_SET],BUTTON_SINGLE_CLICK,NULL,button,NULL));
  char id[37]={0}; bool pending=false,recording=false,busy=false,storage_error=false; int64_t started=0;
  int recovered=hs_outbox_recover(id);
  pending=recovered==HS_OUTBOX_OK;storage_error=recovered==HS_OUTBOX_ERROR;
  ESP_LOGI("FreshMate", "outbox recovery=%d id=%s",recovered,id);
  if(pending) hs_display_text("发现待上传录音。按 SET 重试。");
  if(storage_error) hs_display_text("录音恢复失败，原文件已保留。请检查存储卡。");
  for(;;) {
    result_t result; int action;
    if(xQueueReceive(results,&result,0)) {
      busy=false; hs_display_text(result.message);
      esp_err_t playback=result.success==2?hs_audio_play():ESP_ERR_INVALID_STATE;
      ESP_LOGI("FreshMate", "播放 id=%s result=%s",id,esp_err_to_name(playback));
      if(result.success==2 && playback==ESP_OK) {
        if(hs_outbox_complete(id)==HS_OUTBOX_OK) {
          int next=hs_outbox_recover(id);
          pending=next==HS_OUTBOX_OK;storage_error=next==HS_OUTBOX_ERROR;
          ESP_LOGI("FreshMate", "播放完成，outbox=%d",next);
          if(pending) hs_display_text("还有待上传录音。按 SET 继续。");
          if(storage_error) hs_display_text("录音恢复失败，原文件已保留。请检查存储卡。");
        } else {storage_error=true;hs_display_text("已处理库存，存储确认失败。重启后可用原 ID 安全重试。");}
      } else if(result.success) hs_display_text("操作已完成，播报未完成。按 SET 重试不会重复执行。");
    }
    bool clicked=xQueueReceive(buttons,&action,recording?0:pdMS_TO_TICKS(30));
    if(clicked && action==2) {ESP_LOGI("FreshMate", "state recording=%d pending=%d busy=%d storage_error=%d id=%s",recording,pending,busy,storage_error,id);continue;}
    if(busy) continue;
    if(recording) {
      esp_err_t e=hs_audio_read();
      if(clicked || e!=ESP_OK || esp_timer_get_time()-started>=59000000) {
        recording=false;
        ESP_LOGI("FreshMate", "录音停止");
        if(hs_audio_stop()!=ESP_OK || e!=ESP_OK || hs_outbox_commit(id)!=HS_OUTBOX_OK) {
          storage_error=true;hs_display_text("录音保存未完成，原文件已保留。请重启恢复。");continue;
        }
        pending=true; busy=true; xQueueSend(uploads,id,0); hs_display_text("正在上传并识别，请稍候。");
      }
    } else if(clicked) {
      if(pending) { busy=true; xQueueSend(uploads,id,0); hs_display_text("正在重试，请稍候。"); }
      else if(storage_error) hs_display_text("存储需要检查，原录音已保留。请重启恢复。");
      else {
        char path[HS_OUTBOX_PATH_SIZE];uuid(id);
        if(hs_outbox_path(id,"part",path,sizeof(path))==0 && hs_audio_start(path)==ESP_OK) {
          ESP_LOGI("FreshMate", "录音开始 id=%s",id);recording=true;started=esp_timer_get_time();
          hs_display_text("正在录音，请说买了两个西红柿。按 SET 停止。");
        } else {storage_error=true;hs_display_text("录音启动失败，请重启检查存储。");}
      }
    }
  }
}
