idf_component_register(SRCS "main.c" "factory_demo_usb_hid.c"
    INCLUDE_DIRS "." "${CMAKE_CURRENT_LIST_DIR}/../../../../data/hardware/ble-usb-20261020"
    REQUIRES network_provisioning nvs_flash esp_wifi esp_netif esp_event protocomm usb_host_hid)
