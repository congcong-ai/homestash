import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("本地招呼六句轮换、每轮不重样，跨轮不连播同一句",()=>{
 const dir=mkdtempSync(join(tmpdir(),"yard-greeting-"));
 try{
  const source=join(dir,"test.c"),binary=join(dir,"test");
  writeFileSync(source,`#include "yard_greeting.h"
#include <assert.h>
int main(void){for(unsigned seed=0;seed<64;seed++){yard_greeting_state_t s={.last=YARD_GREETING_NONE};unsigned previous=99,r=seed;for(unsigned round=0;round<100;round++){unsigned used=0;for(unsigned k=0;k<6;k++){r=r*1664525u+1013904223u;unsigned i=yard_greeting_next(&s,r);assert(i<6&&i!=previous&&!(used&(1u<<i)));used|=1u<<i;previous=i;}assert(used==63);}}return 0;}`);
  const build=spawnSync("cc",["-Wall","-Wextra","-Werror","-Ifirmware/apps/food-spirit-yard",source,"-o",binary],{encoding:"utf8"});assert.equal(build.status,0,build.stderr);
  const run=spawnSync(binary,[],{encoding:"utf8"});assert.equal(run.status,0,run.stderr);
  const phrases=JSON.parse(readFileSync("firmware/apps/food-spirit-yard/greetings.json","utf8")) as string[];
  assert.equal(phrases.length,6);assert.equal(new Set(phrases).size,6);
  const assets=readFileSync("firmware/apps/food-spirit-yard/local_replies.h","utf8");
  for(const text of phrases)assert.ok(assets.includes(JSON.stringify(text)));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
