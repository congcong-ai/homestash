#include "hs_audio.h"
#include "hs_power.h"
#include "hs_provisioning.h"
#include "hs_device_config.h"
#include "hs_settings_ui.h"
#include "hs_ota.h"
#include "esp_system.h"
#include "cJSON.h"
#include "hs_camera.h"
#include "hs_storage.h"
#include "hs_outbox.h"
#include "hs_display.h"
#include "hs_transport.h"
#include "hs_network.h"
#include "wifi_profiles.h"
#include "hs_board.h"
#include "hs_device_policy.h"
#include "freshmate_app.h"
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
typedef struct { int kind; int page; char id[37]; } job_t;
typedef struct { int kind; int page; int success; char message[1024]; } result_t;
static void input_action(hs_action_t action) { int value=(int)action; xQueueSend(buttons,&value,0); }
static void uuid(char id[37]) {
  unsigned char b[16]; esp_fill_random(b,16); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  snprintf(id,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
static void upload(void *arg) {
  job_t job;int page=0;unsigned connection_failures=0;int64_t reconnect_after=0;
  for(;;) {
    if(!xQueueReceive(uploads,&job,pdMS_TO_TICKS(5000))) {
      hs_wifi_status_t status; hs_wifi_status(&status);
      if(status.connected) {
        esp_err_t heartbeat=hs_transport_heartbeat();
        ESP_LOGI("FreshMate", "Core heartbeat: %s", esp_err_to_name(heartbeat));
        connection_failures=heartbeat==ESP_ERR_HTTP_CONNECT?connection_failures+1:0;
        if(!hs_provision_active() && connection_failures>=3 && esp_timer_get_time()>=reconnect_after) {
          ESP_LOGW("FreshMate","Core连续连接失败，尝试一次网络恢复；至少间隔120秒");
          hs_wifi_reconnect();connection_failures=0;reconnect_after=esp_timer_get_time()+120000000;
        }
      }
      job=(job_t){.kind=2,.page=page};
    }
    const char *id=job.id;
    result_t r={.kind=job.kind}; hs_wifi_status_t status; hs_wifi_status(&status);
    if(job.kind==5 || job.kind==6) {
      esp_err_t err=hs_wifi_pause(true);
      if(err==ESP_OK)err=hs_display_suspend();
      if(err==ESP_OK)err=hs_power_experiment(job.kind==6,3);
      esp_err_t display_resumed=hs_display_resume();
      if(display_resumed!=ESP_OK) {
        ESP_LOGE("FreshMate","休眠后显示恢复失败：%s，重启恢复设备",esp_err_to_name(display_resumed));
        esp_restart();
      }
      esp_err_t resumed=hs_wifi_pause(false);
      snprintf(r.message,sizeof(r.message),"休眠实验：%s，网络恢复：%s。请点击页面刷新。",esp_err_to_name(err),esp_err_to_name(resumed));
      r.kind=3;xQueueSend(results,&r,portMAX_DELAY);continue;
    }
    if(job.kind==3 || job.kind==4) {
      esp_err_t err=job.kind==3?hs_ota_check():hs_ota_install();
      hs_ota_status_t state;hs_ota_status(&state);snprintf(r.message,sizeof(r.message),"%s",state.message);
      r.success=err==ESP_OK?(job.kind==4?4:1):0;r.kind=3;xQueueSend(results,&r,portMAX_DELAY);continue;
    }
    if(job.kind==2) {
      page=job.page;r.page=page;
      if(status.connected) r.success=hs_transport_screen(page,r.message,sizeof(r.message))==ESP_OK;
      if(!r.success) snprintf(r.message,sizeof(r.message),"Core 暂时无法连接，页面未更新。联网后将自动刷新，SET 可录音。");
      xQueueSend(results,&r,portMAX_DELAY);continue;
    }
    if(job.kind==1) {
      esp_err_t photo=hs_camera_capture(id);
      if(photo==ESP_OK) {
        if(status.connected && hs_transport_photo(id,r.message,sizeof(r.message))==ESP_OK) {
          r.success=hs_camera_complete(id)==ESP_OK?3:0;
        }
      }
      if(!r.success) snprintf(r.message,sizeof(r.message),photo==ESP_OK?"照片已保存，上传未完成。按 MODE 重试。":"相机初始化或拍照失败，请检查摄像头模组与排线。SET 可录音，MODE 重试。");
      ESP_LOGI("FreshMate","photo=%s result=%d",id,r.success);
      xQueueSend(results,&r,portMAX_DELAY);continue;
    }
    if(status.connected && hs_transport_capture(id,r.message,sizeof(r.message))==ESP_OK) {
      r.success=hs_transport_reply(id)==ESP_OK?2:1;
    }
    if(!r.success) snprintf(r.message,sizeof(r.message),"上传未完成，录音已保留。按 SET 重试。");
    ESP_LOGI("FreshMate", "capture=%s result=%d", id, r.success);
    xQueueSend(results,&r,portMAX_DELAY);
  }
}
static void console(void *arg) {
  char line[1024]; size_t length=0;bool overflow=false;
  for(;;) {
    int c=getchar();
    if(c==EOF) {vTaskDelay(pdMS_TO_TICKS(20));continue;}
    if(c=='\n' || c=='\r') {
      line[length]=0;
      if(overflow){length=0;overflow=false;ESP_LOGW("FreshMate","串口命令过长，已拒绝");continue;}
      if(!strcmp(line,"wifi-scan"))hs_wifi_scan();
      if(!strcmp(line,"ble-start") || !strcmp(line,"ble-stop")) {int action=!strcmp(line,"ble-start")?24:25;xQueueSend(buttons,&action,0);}
      if(!strcmp(line,"ble-status")){hs_provision_status_t s;hs_provision_status(&s);ESP_LOGI("FreshMate","BLE active=%d applying=%d state=%s seconds=%u",s.active,s.applying,s.state,s.seconds_left);memset(&s,0,sizeof(s));}
      if(!strcmp(line,"ble-private")){hs_provision_status_t s;hs_provision_status(&s);if(s.active)printf("HS_BLE_PRIVATE {\"name\":\"%s\",\"proof\":\"%s\"}\n",s.name,s.proof);memset(&s,0,sizeof(s));}
      if(!strcmp(line,"wifi-auto"))hs_wifi_automatic();
      if(!strcmp(line,"wifi-reconnect"))hs_wifi_reconnect();
      if(!strcmp(line,"wifi-status")){hs_wifi_status_t s;hs_wifi_status(&s);ESP_LOGI("FreshMate","Wi-Fi connected=%d saved-mode=%d visible=%u message=%s",s.connected,s.automatic,s.count,s.message);}
      if(!strncmp(line,"wifi-connect ",13)) {
        cJSON *j=cJSON_Parse(line+13),*ssid=cJSON_GetObjectItemCaseSensitive(j,"ssid"),*password=cJSON_GetObjectItemCaseSensitive(j,"password"),*open=cJSON_GetObjectItemCaseSensitive(j,"open");
        esp_err_t err=ESP_ERR_INVALID_ARG;
        if(cJSON_IsString(ssid) && cJSON_IsString(password) && strlen(ssid->valuestring)<=32) {
          hs_wifi_ap_t ap={.open=cJSON_IsTrue(open)};snprintf(ap.ssid,sizeof(ap.ssid),"%s",ssid->valuestring);
          err=hs_wifi_connect(&ap,password->valuestring);
        }
        cJSON_Delete(j);ESP_LOGI("FreshMate","手动配网提交：%s",esp_err_to_name(err));
      }
      if(!strncmp(line,"core-config ",12)) {
        cJSON *j=cJSON_Parse(line+12),*url=cJSON_GetObjectItemCaseSensitive(j,"url"),*id=cJSON_GetObjectItemCaseSensitive(j,"deviceId"),*token=cJSON_GetObjectItemCaseSensitive(j,"token");
        esp_err_t err=ESP_ERR_INVALID_ARG;
        if(cJSON_IsString(url) && cJSON_IsString(id) && cJSON_IsString(token))err=hs_device_config_save(url->valuestring,id->valuestring,token->valuestring);
        cJSON_Delete(j);ESP_LOGI("FreshMate","Core 配置保存：%s",esp_err_to_name(err));
      }
      if(!strcmp(line,"ota-check") || !strcmp(line,"ota-install")) {int action=!strcmp(line,"ota-check")?20:21;xQueueSend(buttons,&action,0);}

      if(!strcmp(line,"sleep-light") || !strcmp(line,"sleep-deep")) {int action=!strcmp(line,"sleep-light")?22:23;xQueueSend(buttons,&action,0);}
      if(!strcmp(line,"photo")) input_action(HS_ACTION_PHOTO);
      if(!strncmp(line,"screen ",7) && line[7]>='0' && line[7]<='5' && !line[8]) {int action=10+line[7]-'0';xQueueSend(buttons,&action,0);}
      if(!strcmp(line,"record")) input_action(HS_ACTION_VOICE_TOGGLE);
      if(!strcmp(line,"status")) {int action=2;xQueueSend(buttons,&action,0);}
      memset(line,0,sizeof(line));length=0;
    } else if(length<sizeof(line)-1) line[length++]=c;else overflow=true;
  }
}
static void navigate_page(int page) {int action=10+page;xQueueSend(buttons,&action,0);}
static void settings_action(int action) {xQueueSend(buttons,&action,0);}
void freshmate_app_run(void) {
  hs_power_boot();
  /* 不擦除既有 NVS，不格式化 SD，也不访问工牌业务目录。 */
  ESP_ERROR_CHECK(nvs_flash_init());
  ESP_ERROR_CHECK(hs_device_config_init());
  ESP_ERROR_CHECK(hs_display_init());
  if(hs_storage_init()!=ESP_OK) { hs_ota_boot_health(false); hs_display_text("无法挂载设备存储，请检查。不会自动格式化。"); return; }
  if(hs_board_has(HS_CAP_AUDIO_INPUT) || hs_board_has(HS_CAP_AUDIO_OUTPUT)) ESP_ERROR_CHECK(hs_audio_init());
  ESP_ERROR_CHECK(hs_network_init());
  if(hs_board_has(HS_CAP_BLE_PROVISIONING)) ESP_ERROR_CHECK(hs_provision_init());
  buttons=xQueueCreate(4,sizeof(int)); uploads=xQueueCreate(4,sizeof(job_t)); results=xQueueCreate(1,sizeof(result_t));
  configASSERT(buttons && uploads && results);
  configASSERT(xTaskCreate(console,"串口调试",12288,NULL,3,NULL)==pdPASS);
  configASSERT(xTaskCreate(upload,"上传",16384,NULL,4,NULL)==pdPASS);
  hs_display_navigation(navigate_page);
  ESP_ERROR_CHECK(hs_settings_ui_init(settings_action));
  ESP_ERROR_CHECK(hs_board_inputs_init(input_action));
  char photo_id[37]={0};int photo_state=hs_camera_recover(photo_id);
  ESP_LOGI("FreshMate","photo recovery=%d id=%s",photo_state,photo_id);
  char id[37]={0}; bool pending=false,recording=false,busy=false,storage_error=false; int64_t started=0;
  int recovered=hs_outbox_recover(id);
  pending=recovered==HS_OUTBOX_OK;storage_error=recovered==HS_OUTBOX_ERROR;
  ESP_LOGI("FreshMate", "outbox recovery=%d id=%s",recovered,id);
  if(photo_state==1) hs_display_text("发现待上传照片。按 MODE 重试。SET 可录音。");
  if(pending) hs_display_text("发现待上传录音。按 SET 重试。");
  if(storage_error) hs_display_text("录音恢复失败，原文件已保留。请检查存储卡。");
  bool boot_checked=false;int64_t boot_ready=esp_timer_get_time()+30000000;
  int selected_page=0;bool dashboard=!pending && photo_state!=1 && !storage_error;
  for(;;) {
    hs_settings_ui_busy(busy || recording);
    hs_power_activity(busy || recording);
    if(!boot_checked && esp_timer_get_time()>=boot_ready) {hs_ota_boot_health(true);boot_checked=true;}
    result_t result; int action;
    if(xQueueReceive(results,&result,0)) {
      if(result.kind==3) {
        busy=false;hs_display_text(result.message);
        if(result.success==4){vTaskDelay(pdMS_TO_TICKS(2000));esp_restart();}
        continue;
      }
      if(result.kind==2) {
        if(dashboard && !recording && !busy && result.page==selected_page) hs_display_text(result.message);
      } else {
      busy=false; dashboard=false;hs_display_text(result.message);
      if(result.kind==1) {
        /* 拍摄失败且没有JPEG时不伪造待上传任务；已保存的照片仍保留重试。 */
        photo_state=hs_camera_recover(photo_id);
        continue;
      }
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
      }
    bool clicked=xQueueReceive(buttons,&action,recording?0:pdMS_TO_TICKS(30));
    if(clicked && action==2) {ESP_LOGI("FreshMate", "state recording=%d pending=%d busy=%d storage_error=%d id=%s photo_state=%d photo_id=%s",recording,pending,busy,storage_error,id,photo_state,photo_id);continue;}
    if(clicked && action==25){hs_provision_stop();continue;}
    if(busy) continue;
    if(clicked && !hs_device_action_supported(hs_board_descriptor(),(hs_action_t)action)) {hs_display_text("此设备不支持该硬件操作，请使用网页完成。");continue;}
    if(clicked && action==24){
      if(recording||pending||photo_state==1||storage_error||!boot_checked){hs_display_text("请先完成待处理任务和启动自检，再开启蓝牙配网。");continue;}
      esp_err_t err=hs_provision_start();ESP_LOGI("FreshMate","产品BLE开启：%s",esp_err_to_name(err));continue;
    }
    if(hs_provision_active()) {
      if(clicked)hs_display_text("蓝牙配网窗口内请先完成或取消配网，再录音、拍照或更新。");
      continue;
    }
    if(clicked && (action==22 || action==23)) {
      if(recording || pending || photo_state==1 || storage_error || !boot_checked) {hs_display_text("请先完成待处理录音、照片和启动自检，再做休眠实验。");continue;}
      dashboard=false;job_t job={.kind=action==22?5:6};busy=xQueueSendToFront(uploads,&job,0)==pdTRUE;continue;
    }
    if(clicked && (action==20 || action==21)) {
      if(recording || !boot_checked) {hs_display_text("请等待录音结束和启动自检完成后再更新。");continue;}
      job_t job={.kind=action==20?3:4};busy=xQueueSendToFront(uploads,&job,0)==pdTRUE;continue;
    }
    if(clicked && action>=10 && action<16) {
      if(recording) continue;
      int next=action-10;job_t job={.kind=2,.page=next};
      if(xQueueSend(uploads,&job,0)==pdTRUE) {
        selected_page=next;dashboard=true;hs_display_select_page(next);hs_display_text("正在同步页面，请稍候。");
      }
      continue;
    }
    if(clicked && action==3) {
      if(recording) continue;
      if(photo_state<0) {hs_display_text("照片存储需要检查。请检查设备存储后重启。");continue;}
      if(!photo_state) uuid(photo_id);
      job_t job={.kind=1};snprintf(job.id,sizeof(job.id),"%s",photo_id);
      dashboard=false;busy=xQueueSendToFront(uploads,&job,0)==pdTRUE;
      if(!busy) {hs_display_text("设备正在同步，请稍后按 MODE 重试。");continue;}
      hs_display_text(photo_state?"正在重试照片，请稍候。":"正在拍照并识别，请稍候。");continue;
    }
    if(recording) {
      esp_err_t e=hs_audio_read();
      if((clicked && action==1) || e!=ESP_OK || esp_timer_get_time()-started>=59000000) {
        recording=false;
        ESP_LOGI("FreshMate", "录音停止");
        if(hs_audio_stop()!=ESP_OK || e!=ESP_OK || hs_outbox_commit(id)!=HS_OUTBOX_OK) {
          storage_error=true;hs_display_text("录音保存未完成，原文件已保留。请重启恢复。");continue;
        }
        pending=true; busy=true; {job_t job={0};snprintf(job.id,sizeof(job.id),"%s",id);busy=xQueueSendToFront(uploads,&job,0)==pdTRUE;} hs_display_text(busy?"正在上传并识别，请稍候。":"录音已保存，设备正在同步。请按 SET 重试。");
      }
    } else if(clicked && action==1) {
      dashboard=false;
      if(pending) { busy=true; {job_t job={0};snprintf(job.id,sizeof(job.id),"%s",id);busy=xQueueSendToFront(uploads,&job,0)==pdTRUE;} hs_display_text(busy?"正在重试，请稍候。":"录音已保留，请稍后按 SET 重试。"); }
      else if(storage_error) hs_display_text("存储需要检查，原录音已保留。请重启恢复。");
      else {
        char path[HS_OUTBOX_PATH_SIZE];uuid(id);
        if(hs_outbox_path(id,"part",path,sizeof(path))==0 && hs_audio_start(path)==ESP_OK) {
          ESP_LOGI("FreshMate", "录音开始 id=%s",id);recording=true;started=esp_timer_get_time();
          hs_display_text("正在录音，请说话。按 SET 停止。");
        } else {storage_error=true;hs_display_text("录音启动失败，请重启检查存储。");}
      }
    }
  }
}
