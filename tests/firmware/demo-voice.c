#include <assert.h>
#include "demo_voice.h"
int main(void){
 const int counts[]={2,1,4,2,3,2};const int commands[][4]={{100,1},{9},{9,9,9,9},{7,2},{3,4,5},{8,6}};
 for(int scene=0;scene<6;scene++)for(int step=0;step<counts[scene];step++){
  assert(demo_voice_accept(scene,step,commands[scene][step]));
  assert(!demo_voice_accept(scene,step,10));
  assert(demo_voice_cue(scene,step)[0]);
 }
 assert(demo_voice_auto_intro(3,0,true));assert(demo_voice_auto_intro(5,0,true));
 assert(!demo_voice_auto_intro(3,1,true));assert(!demo_voice_auto_intro(3,0,false));
 assert(!demo_voice_accept(4,0,4));assert(demo_voice_accept(4,0,3));assert(demo_voice_accept(4,1,4));assert(demo_voice_accept(4,2,5));
 return 0;
}
