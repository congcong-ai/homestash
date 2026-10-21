idf_component_register(SRCS "hs_display.c" "hs_font.c" INCLUDE_DIRS "include" REQUIRES device_port esp32_s31_korvo espressif__esp_lvgl_adapter)
target_compile_definitions(${COMPONENT_LIB} PRIVATE LV_LVGL_H_INCLUDE_SIMPLE)
