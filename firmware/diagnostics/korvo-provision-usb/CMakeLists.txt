cmake_minimum_required(VERSION 3.16)
set(PROJECT_VER "0.1.0-diagnostic")
set(EXTRA_COMPONENT_DIRS
    "${CMAKE_CURRENT_LIST_DIR}/../../../data/hardware/ble-usb-20261020/sdk-components/protobuf-c"
    "${CMAKE_CURRENT_LIST_DIR}/../../../data/hardware/retest-20261019/bt-components/bt"
    "${CMAKE_CURRENT_LIST_DIR}/../../../data/hardware/ble-usb-20261020/upstream/network_provisioning"
    "${CMAKE_CURRENT_LIST_DIR}/../../../data/hardware/ble-usb-20261020/upstream/json_generator")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(korvo_provision_usb_probe)
