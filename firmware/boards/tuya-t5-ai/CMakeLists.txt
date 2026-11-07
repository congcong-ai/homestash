# 由 TuyaOpen 顶层工程 include；不复制公共应用和 SDK 源码。
set(HS_FIRMWARE_ROOT "${CMAKE_CURRENT_LIST_DIR}/../..")
add_library(${EXAMPLE_LIB})
target_sources(${EXAMPLE_LIB} PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}/src/main.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_board.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_audio.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_display.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_storage.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_optional.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_runtime.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_network.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_discovery.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_device_config.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_transport.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_http.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_fs.c"
  "${HS_FIRMWARE_ROOT}/apps/food-spirit-yard/yard_app.c"
  "${HS_FIRMWARE_ROOT}/apps/food-spirit-yard/yard_console.c"
  "${HS_FIRMWARE_ROOT}/shared/components/device_port/hs_device_policy.c"
  "${HS_FIRMWARE_ROOT}/shared/components/outbox/hs_outbox.c"
  "${HS_FIRMWARE_ROOT}/shared/assets/hs_font.c")
target_include_directories(${EXAMPLE_LIB} PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}/build"
  "${PLATFORM_PATH}/../../src/libhttp/coreHTTP"
  "${PLATFORM_PATH}/../../src/libhttp/coreHTTP/source/include"
  "${PLATFORM_PATH}/t5_os/ap/components/bk_vfs"
  "${PLATFORM_PATH}/t5_os/ap/components/fatfs"
  "${HS_FIRMWARE_ROOT}/apps/food-spirit-yard"
  "${HS_FIRMWARE_ROOT}/shared/components/device_port/include"
  "${HS_FIRMWARE_ROOT}/shared/components/outbox/include")
target_compile_definitions(${EXAMPLE_LIB} PRIVATE
  HS_PLATFORM_TUYA=1 HS_DATA_ROOT="/sdcard/homestash-t5" LV_LVGL_H_INCLUDE_SIMPLE=1)

# 从锁定 SDK 的真实编译数据库读取内部 FatFs 头文件配置，仅用于文件系统适配。
include("${CMAKE_CURRENT_LIST_DIR}/build/native-includes.cmake")
list(TRANSFORM HS_T5_NATIVE_INCLUDES PREPEND "-isystem")
set_property(SOURCE "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_fs.c" APPEND PROPERTY COMPILE_OPTIONS ${HS_T5_NATIVE_INCLUDES})

# 原厂 FreeRTOS 头在仅使用 FatFs 类型时会留下未使用的 inline 声明；保留警告，不影响应用其他源文件的 -Werror。
set_property(SOURCE "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_fs.c" APPEND PROPERTY COMPILE_OPTIONS "-Wno-error=unused-function")

# 默认关闭诊断，联网调试镜像不会包含或执行IMU/相机探测。
if("$ENV{HOMESTASH_T5_SENSOR_DIAGNOSTICS}" STREQUAL "1")
  target_sources(${EXAMPLE_LIB} PRIVATE "${CMAKE_CURRENT_LIST_DIR}/src/hs_imu_probe.c" "${CMAKE_CURRENT_LIST_DIR}/src/hs_camera_probe.c")
  target_compile_definitions(${EXAMPLE_LIB} PRIVATE HS_YARD_SENSOR_DIAGNOSTICS=1)
else()
  target_compile_definitions(${EXAMPLE_LIB} PRIVATE HS_YARD_SENSOR_DIAGNOSTICS=0)
endif()

# USB 枚举专用入口独立于 DVP/IMU 诊断，不启动视频流。
if("$ENV{HOMESTASH_T5_UVC_DIAGNOSTICS}" STREQUAL "1")
  target_sources(${EXAMPLE_LIB} PRIVATE "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_probe.c" "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_shot.c")
  target_compile_definitions(${EXAMPLE_LIB} PRIVATE HS_YARD_UVC_DIAGNOSTICS=1)
  target_include_directories(${EXAMPLE_LIB} PRIVATE "${PLATFORM_PATH}/t5_os/ap/components/multimedia/include")
  set_property(SOURCE "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_shot.c" APPEND PROPERTY COMPILE_OPTIONS "-Wno-error=unused-function")
  set_property(SOURCE "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_probe.c" "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_shot.c" APPEND PROPERTY COMPILE_OPTIONS ${HS_T5_NATIVE_INCLUDES})
endif()

# 正式小院单帧接口：不输出串口图像，不依赖诊断开关。
target_sources(${EXAMPLE_LIB} PRIVATE "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_photo.c")
target_include_directories(${EXAMPLE_LIB} PRIVATE "${PLATFORM_PATH}/t5_os/ap/components/multimedia/include")
set_property(SOURCE "${CMAKE_CURRENT_LIST_DIR}/src/hs_uvc_photo.c" APPEND PROPERTY COMPILE_OPTIONS ${HS_T5_NATIVE_INCLUDES} "-Wno-error=unused-function")
