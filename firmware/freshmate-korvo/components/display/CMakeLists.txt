idf_component_register(SRCS "hs_display.c" "hs_font.c" INCLUDE_DIRS "include" REQUIRES esp32_s31_korvo)
target_compile_definitions(${COMPONENT_LIB} PRIVATE LV_LVGL_H_INCLUDE_SIMPLE)
