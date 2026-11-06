idf_component_register(SRCS "hs_device_config.c" INCLUDE_DIRS "." "${CMAKE_BINARY_DIR}" REQUIRES device_port nvs_flash http_parser)
