#pragma once
#include <stdint.h>
/* 每袋六句各用一次；换袋时也不连续重复。随机数由板端提供。 */
#define YARD_GREETING_COUNT 6
#define YARD_GREETING_NONE 255
typedef struct {uint8_t remaining,last;} yard_greeting_state_t;
static inline unsigned yard_greeting_next(yard_greeting_state_t *s,uint32_t random){
 if(!s->remaining)s->remaining=(1u<<YARD_GREETING_COUNT)-1;
 unsigned candidates=s->remaining;
 if(s->last<YARD_GREETING_COUNT && (candidates&(candidates-1)))candidates&=~(1u<<s->last);
 unsigned count=0;for(unsigned i=0;i<YARD_GREETING_COUNT;i++)if(candidates&(1u<<i))count++;
 unsigned rank=random%count,index=0;
 for(;index<YARD_GREETING_COUNT;index++)if(candidates&(1u<<index)){if(!rank)break;rank--;}
 s->remaining&=~(1u<<index);s->last=(uint8_t)index;return index;
}
