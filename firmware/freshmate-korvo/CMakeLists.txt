cmake_minimum_required(VERSION 3.16)
if(DEFINED ENV{HOMESTASH_FIRMWARE_VERSION})
  set(PROJECT_VER "$ENV{HOMESTASH_FIRMWARE_VERSION}")
else()
  set(PROJECT_VER "0.5.0")
endif()
add_compile_definitions(HS_DATA_ROOT="/sdcard/homestash")
set(EXTRA_COMPONENT_DIRS
  "${CMAKE_CURRENT_LIST_DIR}/../common/components"
  "${CMAKE_CURRENT_LIST_DIR}/../apps/freshmate_app"
  "${CMAKE_CURRENT_LIST_DIR}/../../vendor/espressif/esp32-s31-korvo/components"
  "${CMAKE_CURRENT_LIST_DIR}/../../data/hardware/esp-idf-ble-components/bt"
  "${CMAKE_CURRENT_LIST_DIR}/../../data/hardware/esp-idf-ble-components/protobuf-c")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(homestash_freshmate)
idf_component_get_property(hs_lvgl_lib lvgl__lvgl COMPONENT_LIB)
# 只对内存池源文件注入属性，避免改变SDL等其他后端的系统头加载顺序。
get_target_property(hs_lvgl_sources ${hs_lvgl_lib} SOURCES)
get_target_property(hs_lvgl_source_dir ${hs_lvgl_lib} SOURCE_DIR)
foreach(hs_lvgl_source IN LISTS hs_lvgl_sources)
  if(hs_lvgl_source MATCHES "/lv_mem_core_builtin\\.c$")
    set_property(SOURCE "${hs_lvgl_source}" DIRECTORY "${hs_lvgl_source_dir}"
      APPEND PROPERTY COMPILE_OPTIONS "-include${CMAKE_CURRENT_LIST_DIR}/components/display/include/hs_lvgl_memory.h")
  endif()
endforeach()
