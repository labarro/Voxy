// Full native client -> local Worker -> signed SDP/ICE -> native DTLS/SCTP.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
const result = await build({ entryPoints:['src/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022' });
const emulator = new Miniflare({port:8787,host:'127.0.0.1',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-07-30',durableObjects:{ROOMS:{className:'SignalRoom',useSQLite:true},ADMISSION:{className:'AdmissionBudget',useSQLite:true}},bindings:{VOXY_DEPLOYMENT_ENABLED:'true',VOXY_RELAY_ENABLED:'false',VOXY_DAILY_ADMISSIONS:'1000',VOXY_MAX_ROOMS:'10'}});
try {
  await emulator.ready;
  const binary=resolve('../../native/target/debug/voxy-core.exe');
  const child=spawn(binary,['signaling-check','ws://127.0.0.1:8787'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const timer=setTimeout(()=>child.kill(),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});clearTimeout(timer);
  if(code!==0)throw Error(`Native test exited ${code}: ${stderr}`);
  const report=JSON.parse(stdout.trim());
  if(!report.payloadReceived||!report.signedSdpIce)throw Error('Missing verification');
  await mkdir('../../evidence/native-2.0',{recursive:true});
  await writeFile('../../evidence/native-2.0/signaling-integration.json',JSON.stringify({measuredAt:new Date().toISOString(),...report},null,2)+'\n');
  console.log(JSON.stringify(report));
} finally { await emulator.dispose(); }
