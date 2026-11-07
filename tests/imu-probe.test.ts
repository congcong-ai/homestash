import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('IMU 开漏诊断的高阻释放、ID位序、NACK拒绝与GPIO失败',()=>{
 const dir=mkdtempSync(join(tmpdir(),'homestash-imu-'));
 try{
 const binary=join(dir,'test');
 const build=spawnSync('cc',['-Wall','-Wextra','-Werror','-I','tests/firmware/imu-mocks','-I','firmware/shared/components/device_port/include','tests/firmware/imu-probe.c','-o',binary],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
