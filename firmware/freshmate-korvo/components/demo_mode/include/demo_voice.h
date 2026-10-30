#pragma once
#include <stdbool.h>
/* 提示词和触发条件共用此表；不能再把已识别指令静默丢弃。 */
static inline int demo_voice_command(int scene,int step){
 static const int ids[6][4]={{100,1,0,0},{9,0,0,0},{9,9,9,9},{7,2,0,0},{3,4,5,0},{8,6,0,0}};
 return scene>=0&&scene<6&&step>=0&&step<4?ids[scene][step]:0;
}
static inline bool demo_voice_auto_intro(int scene,int step,bool awake){return awake&&step==0&&(scene==3||scene==5);}
static inline bool demo_voice_accept(int scene,int step,int command){return command==demo_voice_command(scene,step)||(scene==0&&step==0&&command==100);}
static inline const char *demo_voice_cue(int scene,int step){
 switch(demo_voice_command(scene,step)){
 case 100:return "请说：小冰小冰";case 1:return "请说：家里还有鸡蛋吗";case 2:return "请说：怎么啦";case 3:return "请说：今晚吃什么";case 4:return "请说：开始做";case 5:return "请说：下一步";case 6:return "请说：马上给你充电";case 7:return "请说：草莓怎么样";case 8:return "请说：电量告急";case 9:return "请说：打开冰箱";default:return "请重新选择场景";
 }
}
