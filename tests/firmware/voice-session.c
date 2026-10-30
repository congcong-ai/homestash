#include <assert.h>
#include "voice_session.h"
int main(void){
 hs_voice_session_t s={0};assert(!hs_voice_session_awake(&s,0));
 hs_voice_session_touch(&s,100);assert(hs_voice_session_awake(&s,100+59999999));
 assert(!hs_voice_session_awake(&s,100+60000000));
 hs_voice_session_touch(&s,100);hs_voice_session_touch(&s,50000000);
 assert(hs_voice_session_awake(&s,100000000));
 hs_voice_session_end(&s);assert(!hs_voice_session_awake(&s,50000001));
 hs_voice_session_touch(&s,200000000);assert(hs_voice_session_awake(&s,200000001));
 return 0;
}
