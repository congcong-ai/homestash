/* 仅枚举 USB/UVC，不调用 init/start，不采集画面，不修改 LCD/DVP。
 * 须由持有板级 USB 独占权的诊断入口调用，禁止启动时自动执行。 */
#include "hs_runtime.h"
#include "driver/uvc_camera.h"

int hs_t5_uvc_probe(void) {
  int result = bk_uvc_power_on(IMAGE_MJPEG, 4000);
  if (result) {
    HS_LOGW("USB相机", "枚举未成功 code=%d；未拍摄", result);
  } else {
    bk_usb_hub_port_info *port = bk_uvc_get_enum_info(1, IMAGE_MJPEG);
    bk_uvc_device_brief_info_t *info = port ? port->usb_device_param : NULL;
    if (!info) {
      result = -1;
      HS_LOGW("USB相机", "端口1无有效描述符；未拍摄");
    } else {
      HS_LOGI("USB相机", "VID=%04x PID=%04x MJPEG模式数=%u；仅枚举未拍摄",
              info->vendor_id, info->product_id, info->all_frame.mjpeg_frame_num);
      if (info->all_frame.mjpeg_frame_num && !info->all_frame.mjpeg_frame) {
        result = -1;
      } else {
        for (unsigned i = 0; i < info->all_frame.mjpeg_frame_num; ++i) {
          const bk_uvc_frame *frame = &info->all_frame.mjpeg_frame[i];
          HS_LOGI("USB相机", "mode=%u width=%u height=%u frame_interval_count=%u",
                  i, frame->width, frame->height, frame->fps_num);
          /* SDK 字段 fps 的单位须沿描述符转换代码确认，不直接当作帧率打印。 */
        }
      }
    }
  }
  int cleanup = bk_uvc_power_off();
  if (cleanup) HS_LOGW("USB相机", "枚举清理失败 code=%d", cleanup);
  return result ? result : cleanup;
}
