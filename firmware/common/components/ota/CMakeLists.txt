idf_component_register(SRCS "hs_ota.c" INCLUDE_DIRS "include" REQUIRES board device_port protocol device_config app_update mbedtls espressif__cjson esp_app_format)
