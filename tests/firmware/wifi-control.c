#include <assert.h>
#include "wifi_control.h"
int main(void){
 assert(!hs_wifi_control_needed(false,5));
 assert(hs_wifi_control_needed(true,5));
 assert(!hs_wifi_control_needed(true,4));
 assert(hs_wifi_control_needed(false,4));
 assert(hs_wifi_control_needed(false,6));
 assert(hs_wifi_control_needed(true,6));
 assert(hs_wifi_connected_event(3,1));
 assert(!hs_wifi_connected_event(2,1));
 return 0;
}
