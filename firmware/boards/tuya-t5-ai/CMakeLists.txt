# 由 TuyaOpen 顶层工程 include；不复制公共应用和 SDK 源码。
set(HS_FIRMWARE_ROOT "${CMAKE_CURRENT_LIST_DIR}/../..")
add_library(${EXAMPLE_LIB})
target_sources(${EXAMPLE_LIB} PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}/src/main.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_board.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_imu_probe.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_audio.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_display.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_storage.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hs_optional.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_runtime.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_network.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_device_config.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_transport.c"
  "${HS_FIRMWARE_ROOT}/platforms/tuyaopen/hs_fs.c"
  "${HS_FIRMWARE_ROOT}/apps/food-spirit-yard/yard_app.c"
  "${HS_FIRMWARE_ROOT}/apps/food-spirit-yard/yard_console.c"
  "${HS_FIRMWARE_ROOT}/shared/components/device_port/hs_device_policy.c"
  "${HS_FIRMWARE_ROOT}/shared/components/outbox/hs_outbox.c"
  "${HS_FIRMWARE_ROOT}/shared/assets/hs_font.c")
target_include_directories(${EXAMPLE_LIB} PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}/build"
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
