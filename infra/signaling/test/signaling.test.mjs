import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const bundle = await build({ entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const makeKey = () => { const pair = generateKeyPairSync('ed25519'); return { privateKey: pair.privateKey, key: pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url') }; };
function invite(host, room=randomUUID()) {
  const body = { protocol:3,room,host_key:host.key,signal_url:`ws://localhost/v3/${room}`,capability:randomBytes(32).toString('base64url'),expires_at:Date.now()+60000,signature:'' };
  body.signature=sign(null,Buffer.from(JSON.stringify(['voxy-invite-v3',3,body.room,body.host_key,body.signal_url,body.capability,body.expires_at])),host.privateKey).toString('base64url');return body;
}
function headers(invite, peer) {
  const nonce=randomBytes(16).toString('base64url'), now=Date.now();
  const proof=sign(null,Buffer.from(JSON.stringify(['voxy-admission-v3',invite.room,invite.capability,peer.key,nonce,now])),peer.privateKey).toString('base64url');
  return { Upgrade:'websocket','X-Voxy-Invite':`voxy-native://join/${Buffer.from(JSON.stringify(invite)).toString('base64url')}`,'X-Voxy-Peer':peer.key,'X-Voxy-Nonce':nonce,'X-Voxy-Time':String(now),'X-Voxy-Proof':proof };
}
function setup(extra={}) { return new Miniflare({ modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',durableObjects:{ROOMS:{className:'SignalRoom',useSQLite:true},ADMISSION:{className:'AdmissionBudget',useSQLite:true}},bindings:{VOXY_DEPLOYMENT_ENABLED:'true',VOXY_RELAY_ENABLED:'false',VOXY_DAILY_ADMISSIONS:'1000',VOXY_MAX_ROOMS:'10',...extra} }); }
const nextMessage = socket => new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebSocket timeout')),3000);socket.addEventListener('message',e=>{clearTimeout(timer);resolve(JSON.parse(e.data));},{once:true});});

test('deployment and relay fail closed; invalid invites never admit',async()=>{
  for(const config of [{VOXY_DEPLOYMENT_ENABLED:'false'},{VOXY_RELAY_ENABLED:'true'}]){const mf=setup(config);try{assert.equal((await mf.dispatchFetch('http://localhost/health')).status,503);}finally{await mf.dispose();}}
  const mf=setup();try{const host=makeKey(),body=invite(host);const h=headers(body,host);h['X-Voxy-Proof']=randomBytes(64).toString('base64url');assert.equal((await mf.dispatchFetch(body.signal_url.replace('ws:','http:'),{headers:h})).status,403);body.expires_at=0;assert.equal((await mf.dispatchFetch(body.signal_url.replace('ws:','http:'),{headers:headers(body,host)})).status,403);}finally{await mf.dispose();}
});
test('native admission, hibernating WebSockets, private routing, nonce replay and quotas',async()=>{
  const mf=setup({VOXY_DAILY_ADMISSIONS:'3'});let sockets=[];
  try{
    const host=makeKey(),guest=makeKey(),body=invite(host),url=body.signal_url.replace('ws:','http:');const hh=headers(body,host);
    const response=await mf.dispatchFetch(url,{headers:hh});assert.equal(response.status,101);const hs=response.webSocket;sockets.push(hs);const welcome=nextMessage(hs);hs.accept();assert.equal((await welcome).type,'welcome');
    assert.equal((await mf.dispatchFetch(url,{headers:hh})).status,429);
    const joined=nextMessage(hs);const guestResponse=await mf.dispatchFetch(url,{headers:headers(body,guest)});assert.equal(guestResponse.status,101);const gs=guestResponse.webSocket;sockets.push(gs);const gw=nextMessage(gs);gs.accept();assert.equal((await gw).peers[0].key,host.key);assert.equal((await joined).key,guest.key);
    const received=nextMessage(gs);hs.send(JSON.stringify({room:body.room,from:host.key,to:guest.key,session_nonce:hh['X-Voxy-Nonce'],sequence:1,expires_at:Date.now()+10000,payload:{description:'encrypted-transport-fingerprint'},signature:randomBytes(64).toString('base64url')}));assert.equal((await received).from,host.key);
    const other=makeKey();assert.equal((await mf.dispatchFetch(url,{headers:headers(body,other)})).status,101);assert.equal((await mf.dispatchFetch(url,{headers:headers(body,makeKey())})).status,429);
  }finally{for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
});

test('a signal from an old admission nonce closes only the offending peer',async()=>{
  const mf=setup();const sockets=[];
  const open=async(body,peer)=>{const h=headers(body,peer);const r=await mf.dispatchFetch(body.signal_url.replace('ws:','http:'),{headers:h});assert.equal(r.status,101);const s=r.webSocket;sockets.push(s);const welcome=nextMessage(s);s.accept();await welcome;return {s,h};};
  try {
    const host=makeKey(),guest=makeKey(),body=invite(host);
    const {s:hs}=await open(body,host);const joined=nextMessage(hs);
    const {s:gs}=await open(body,guest);await joined;
    const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Peer not closed')),3000);gs.addEventListener('close',e=>{clearTimeout(timer);resolve(e.code)},{once:true});});
    gs.send(JSON.stringify({room:body.room,from:guest.key,to:host.key,session_nonce:randomBytes(16).toString('base64url'),sequence:1,expires_at:Date.now()+10000,payload:{},signature:'invalid-session'}));
    assert.equal(await closed,1008);
    // A new valid participant can still join the same authoritative host.
    const {s:replacement}=await open(body,makeKey());assert.ok(replacement);
  } finally {for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
});


const nextClose = socket => new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Close timeout')),3000);socket.addEventListener('close',e=>{clearTimeout(timer);resolve(e.code)},{once:true});});
async function open(mf, body, peer, sockets) {
  const h=headers(body,peer), response=await mf.dispatchFetch(body.signal_url.replace('ws:','http:'),{headers:h});
  assert.equal(response.status,101);const socket=response.webSocket;sockets.push(socket);const welcome=nextMessage(socket);socket.accept();await welcome;return {socket,h};
}
function signal(body, from, to, h, overrides={}) {
  return {room:body.room,from:from.key,to:to.key,session_nonce:h['X-Voxy-Nonce'],sequence:1,expires_at:Date.now()+10000,payload:{description:{type:'offer',sdp:'fixture'}},signature:randomBytes(64).toString('base64url'),...overrides};
}

test('room, replay, deadline, schema and ICE limits are enforced before routing',async()=>{
  const invalid = [
    {room:randomUUID()},
    {expires_at:Date.now()+120000},
    {sequence:0},
    {sequence:Number.MAX_SAFE_INTEGER+1},
    {expires_at:'future'},
    {payload:{candidate:{candidate:'x'.repeat(4096)}}},
    {payload:{description:{},candidate:{}}},
    {payload:{command:'chat must use the P2P data channel'}},
    {extra:'unknown'},
  ];
  for (const overrides of invalid) {
    const mf=setup(),sockets=[];
    try {
      const host=makeKey(),guest=makeKey(),body=invite(host);
      const {socket:hs}=await open(mf,body,host,sockets);const joined=nextMessage(hs);
      const {socket:gs,h}=await open(mf,body,guest,sockets);await joined;
      const closed=nextClose(gs);gs.send(JSON.stringify(signal(body,guest,host,h,overrides)));assert.equal(await closed,1008);
    } finally {for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
  }
  const mf=setup(),sockets=[];
  try {
    const host=makeKey(),guest=makeKey(),body=invite(host);
    const {socket:hs}=await open(mf,body,host,sockets);const joined=nextMessage(hs);
    const {socket:gs,h}=await open(mf,body,guest,sockets);await joined;
    const first=nextMessage(hs),packet=JSON.stringify(signal(body,guest,host,h));gs.send(packet);assert.equal((await first).sequence,1);
    const closed=nextClose(gs);gs.send(packet);assert.equal(await closed,1008);
  } finally {for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
});

test('host rotates and revokes invite while remaining connected; old capability is denied',async()=>{
  const mf=setup(),sockets=[];
  try {
    const host=makeKey(),guest=makeKey(),body=invite(host);
    const {socket:hs,h}=await open(mf,body,host,sockets);const joined=nextMessage(hs);
    const {socket:gs}=await open(mf,body,guest,sockets);await joined;
    const replacement=invite(host,body.room),revoked=nextMessage(gs),ack=nextMessage(hs);
    hs.send(JSON.stringify({type:'rotate-invite',session_nonce:h['X-Voxy-Nonce'],invite:`voxy://join/${Buffer.from(JSON.stringify(replacement)).toString('base64url')}`}));
    assert.equal((await ack).type,'invite-rotated');assert.equal((await revoked).type,'invite-revoked');gs.close();
    assert.equal((await mf.dispatchFetch(body.signal_url.replace('ws:','http:'),{headers:headers(body,makeKey())})).status,403);
    const {socket:newGuest}=await open(mf,replacement,guest,sockets);assert.ok(newGuest);
  } finally {for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
});

test('guest cannot rotate host invitation and recipient reconnect resets only its replay generation',async()=>{
  const mf=setup(),sockets=[];
  try {
    const host=makeKey(),guest=makeKey(),body=invite(host);
    const {socket:hs,h:hh}=await open(mf,body,host,sockets);const joined=nextMessage(hs);
    const {socket:gs,h:gh}=await open(mf,body,guest,sockets);await joined;
    const initial=nextMessage(gs);hs.send(JSON.stringify(signal(body,host,guest,hh,{sequence:42})));await initial;
    const denied=nextClose(gs),left=nextMessage(hs);
    gs.send(JSON.stringify({type:'rotate-invite',session_nonce:gh['X-Voxy-Nonce'],invite:`voxy://join/${Buffer.from(JSON.stringify(invite(host,body.room))).toString('base64url')}`}));
    assert.equal(await denied,1008);const leftEvent=await left;assert.equal(leftEvent.type,'peer-left');assert.equal(leftEvent.session_nonce,gh['X-Voxy-Nonce']);
    const rejoined=nextMessage(hs),{socket:again}=await open(mf,body,guest,sockets);await rejoined;
    const accepted=nextMessage(again);hs.send(JSON.stringify(signal(body,host,guest,hh)));assert.equal((await accepted).sequence,1);
  } finally {for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
});

test('room quota is a host lease released when the host disconnects, not held until invite expiry',async()=>{
  const mf=setup({VOXY_MAX_ROOMS:'1'});const sockets=[];
  try{
    const first=makeKey(),firstRoom=invite(first);
    const {socket:firstHost}=await open(mf,firstRoom,first,sockets);
    const second=makeKey(),secondRoom=invite(second),secondUrl=secondRoom.signal_url.replace('ws:','http:');
    assert.equal((await mf.dispatchFetch(secondUrl,{headers:headers(secondRoom,second)})).status,429);
    const closed=nextClose(firstHost);firstHost.close(1000,'host left');await closed.catch(()=>{});
    let status=0;
    for(let attempt=0;attempt<20&&status!==101;attempt++){
      const response=await mf.dispatchFetch(secondUrl,{headers:headers(secondRoom,second)});status=response.status;
      if(status===101){sockets.push(response.webSocket);response.webSocket.accept();}else await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(status,101,'second host must obtain the released room slot');
  }finally{for(const socket of sockets){try{socket.close()}catch{}}await mf.dispose();}
});
