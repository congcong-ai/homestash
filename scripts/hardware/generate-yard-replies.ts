import "dotenv/config";
import { createHash } from "node:crypto";
import { BailianSpeechProvider } from "../../packages/ai/src/speech";
import { mkdirSync,writeFileSync,readFileSync,existsSync } from "node:fs";
const provider=new BailianSpeechProvider({baseUrl:process.env.BAILIAN_BASE_URL??"https://dashscope.aliyuncs.com",compatibleUrl:process.env.AI_BASE_URL??"",key:process.env.AI_API_KEY??"",asrModel:"",ttsModel:"qwen3-tts-flash",voice:"Momo"});
const dir="data/hardware/voice-build/yard-short";mkdirSync(dir,{recursive:true});
let header='#pragma once\n/* 百炼Momo预生成，16kHz/单声道/16bit；运行时无网络依赖。 */\n';
async function main(){
const greetings=JSON.parse(readFileSync("firmware/apps/food-spirit-yard/greetings.json","utf8")) as string[];
if(greetings.length!==6||greetings.some(t=>typeof t!=="string"||!t||t.length>20))throw Error("招呼配置不符");
const phrases=[...greetings.map((text,i)=>[`greeting_${i}`,text]),["hello","我在，你说。"],["thanks","不客气。"],["bye","好，回头聊。"]];
for(const [name,text] of phrases){
 const cacheKey=createHash("sha256").update(JSON.stringify([text,"Momo","qwen3-tts-flash","pcm-wav-16k-mono-v1"])).digest("hex");
 const cachePath=`${dir}/${name}-${cacheKey}.wav`;
 const wav=existsSync(cachePath)?readFileSync(cachePath):await provider.synthesize(text);writeFileSync(cachePath,wav);
 if(wav.toString('ascii',36,40)!=='data')throw Error('固定WAV布局不符');
 const raw=wav.subarray(44);let first=0,last=raw.length/2-1;
 while(first<last&&Math.abs(raw.readInt16LE(first*2))<200)first++;
 while(last>first&&Math.abs(raw.readInt16LE(last*2))<200)last--;
 const pcm=raw.subarray(Math.max(0,first-480)*2,Math.min(raw.length,(last+1600)*2));
 if(name.startsWith("greeting_")&&pcm.length>96000)throw Error("招呼音频超过3秒，请缩短文案");
 header+=`static const signed char yard_${name}[]={\n`;
 for(let i=0;i<pcm.length;i+=24)header+=Array.from(pcm.subarray(i,i+24),v=>v>127?v-256:v).join(',')+',\n';
 header+='};\n';console.log(`${name}: ${pcm.length}字节，${Math.round(pcm.length/32)}毫秒`);
}
header+='typedef struct {const signed char *pcm;unsigned size;const char *text;} yard_greeting_clip_t;\n';
header+='static const yard_greeting_clip_t yard_greetings[]={\n';
for(let i=0;i<greetings.length;i++)header+=`{yard_greeting_${i},sizeof(yard_greeting_${i}),${JSON.stringify(greetings[i])}},\n`;
header+='};\n';
writeFileSync('firmware/apps/food-spirit-yard/local_replies.h',header);

}
main().catch(()=>{console.error("短语音生成失败");process.exitCode=1;});
