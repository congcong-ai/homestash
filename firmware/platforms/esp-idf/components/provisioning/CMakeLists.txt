idf_component_register(SRCS "hs_provisioning.c" INCLUDE_DIRS "." REQUIRES device_port protocomm device_config network espressif__cjson esp_timer esp_hw_support mbedtls)
