idf_component_register(SRCS "demo_controller.c" "demo_scenes.c" "wake_ack.c" INCLUDE_DIRS "include" REQUIRES audio display esp32_s31_korvo esp_timer network)
