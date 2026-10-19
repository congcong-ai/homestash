idf_component_register(SRCS "main.c" INCLUDE_DIRS "." "${CMAKE_BINARY_DIR}" REQUIRES audio network display storage protocol esp32_s31_korvo nvs_flash esp_timer)
