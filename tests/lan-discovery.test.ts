import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { startLanDiscovery } from "../services/kitchen-core/src/lan-discovery";
test("局域网发现验证配对签名、随机挑战及服务地址，无效签名无响应", async()=>{
 const key=createHash("sha256").update("测试配对密钥".repeat(5)).digest();
 const sign=(id:string,body:string)=>id==="test-device"?createHmac("sha256",key).update(body).digest("hex"):null;
 const server=await startLanDiscovery({port:3101,discoveryPort:0,sign,addressFor:()=>"127.0.0.1"});
 const client=createSocket("udp4");await new Promise<void>(r=>client.bind(0,"127.0.0.1",r));
 try{
  const nonce=randomBytes(16).toString("hex"),body=`HS_DISCOVER_V1|test-device|${nonce}`;
  const received:string[]=[];client.on("message",p=>received.push(p.toString()));
  client.send(`${body}|${"0".repeat(64)}`,server.address().port,"127.0.0.1");
  await new Promise(r=>setTimeout(r,550));assert.equal(received.length,0);
  const response=new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(Error("发现超时")),1500);client.once("message",p=>{clearTimeout(t);resolve(p.toString());});});
  client.send(`${body}|${sign("test-device",body)}`,server.address().port,"127.0.0.1");
  const message=await response;const expected=`HS_CORE_V1|test-device|${nonce}|127.0.0.1|3101`;
  assert.equal(message,`${expected}|${sign("test-device",expected)}`);
 }finally{client.close();server.close();}
});
