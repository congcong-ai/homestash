idf_component_register(SRCS "hs_transport.c" INCLUDE_DIRS "include" "${CMAKE_BINARY_DIR}" REQUIRES esp_http_client mbedtls espressif__cjson storage esp_timer display)
