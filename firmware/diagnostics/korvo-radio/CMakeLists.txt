cmake_minimum_required(VERSION 3.16)
# SDK 蓝牙依赖仅复制至 HomeStash 的忽略目录，不修改共享 SDK。
set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/../../../data/hardware/retest-20261019/bt-components/bt")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(korvo_radio_probe)
