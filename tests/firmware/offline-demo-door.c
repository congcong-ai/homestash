#include <assert.h>
#include "door_event_source.h"
int main(void){
 demo_door_t d={0};
 for(int i=0;i<4;i++){
 int64_t t=i*3000000;
 assert(demo_door_event(&d,(door_event_t){DOOR_OPEN,DEMO_BUTTON_DOOR_SOURCE,t}));
 assert(!demo_door_event(&d,(door_event_t){DOOR_OPEN,DEMO_BUTTON_DOOR_SOURCE,t+100000}));
 assert(demo_door_event(&d,(door_event_t){DOOR_CLOSE,DEMO_BUTTON_DOOR_SOURCE,t+2500000}));
 assert(d.close_at_us==0);
 }
 assert(d.count==4);return 0;
}
