import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const bundle=await build({entryPoints:['src/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const emulator=new Miniflare({port:8787,host:'127.0.0.1',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',durableObjects:{ROOMS:{className:'SignalRoom',useSQLite:true},ADMISSION:{className:'AdmissionBudget',useSQLite:true},CODES:{className:'InviteCodes',useSQLite:true}},bindings:{VOXY_DEPLOYMENT_ENABLED:'true',VOXY_RELAY_ENABLED:'false',VOXY_DAILY_ADMISSIONS:'1000',VOXY_MAX_ROOMS:'10'}});
try {
  await emulator.ready;
  const cargo=process.platform==='win32'?resolve(process.env.USERPROFILE,'.cargo/bin/cargo.exe'):'cargo';
  const physical=process.env.VOXY_TEST_PHYSICAL_AUDIO==='1';
  const onlyAudio=process.env.VOXY_TEST_ONLY_AUDIO==='1';
  const args=['test','--locked','-p','voxy-cli','--test','session_live',...(onlyAudio?['native_duplex_call_uses_devices']:[]),'--','--ignored','--nocapture',...(!physical?['--skip','native_duplex_call_uses_devices']:[])];
  const child=spawn(cargo,args,{cwd:resolve('../../native'),windowsHide:true,env:{...process.env,VOXY_TEST_SIGNAL_URL:'ws://127.0.0.1:8787',VOXY_TEST_REPORT_DIRECTORY:resolve('../../evidence/native-2.0')},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;process.stdout.write(data)});child.stderr.on('data',data=>process.stderr.write(data));
  const timeout=setTimeout(()=>child.kill(),90000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});clearTimeout(timeout);
  if(code!==0)throw Error('Session integration failed: '+code);
  await writeFile('../../evidence/native-2.0/'+(onlyAudio?'session-call-benchmark':'session-integration'+(physical?'-device-api':''))+'.json',JSON.stringify({checkedAt:new Date().toISOString(),workerEmulator:true,publicInternet:false,physicalDeviceApi:physical,playbackMutedForDeviceTest:physical,acousticQualityValidated:false,syntheticMeshVoice:!onlyAudio,output},null,2)+'\n');
} finally {await emulator.dispose();}
