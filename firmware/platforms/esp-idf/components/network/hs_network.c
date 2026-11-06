#include "hs_network.h"
#include "esp_check.h"
#include "wifi_profiles.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "lwip/dns.h"
#include "lwip/tcpip.h"
static void clear_dns(void *arg){(void)arg;dns_clear_cache();}
static void event(void *arg, esp_event_base_t base, int32_t id, void *data) {
  if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP){tcpip_callback(clear_dns,NULL);hs_wifi_profiles_connected();}
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) hs_wifi_profiles_disconnected();
}
esp_err_t hs_network_init(void) {
  ESP_RETURN_ON_ERROR(esp_netif_init(), "网络", "netif");
  ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), "网络", "event loop");
  if (!esp_netif_create_default_wifi_sta()) return ESP_FAIL;
  wifi_init_config_t c = WIFI_INIT_CONFIG_DEFAULT();
  ESP_RETURN_ON_ERROR(esp_wifi_init(&c), "网络", "wifi");
  ESP_RETURN_ON_ERROR(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, event, NULL), "网络", "handler");
  ESP_RETURN_ON_ERROR(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, event, NULL), "网络", "handler");
  ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM), "网络", "storage");
  ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), "网络", "mode");
  ESP_RETURN_ON_ERROR(esp_wifi_start(), "网络", "start");
  hs_wifi_profiles_start();
  return ESP_OK;
}
