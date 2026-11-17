// Run: node --import tsx evidence/native-2.0/functional/generate-pool-fixtures.ts
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {PoolGame} from "../../../src/shared/pool";
const scenarios:any[]=[];
function scenario(name:string,run:(api:ReturnType<typeof setup>)=>void){const a=setup();run(a);scenarios.push({name,steps:a.steps});}
function setup(){
  const g=new PoolGame(),steps:any[]=[];
  function step(op:any){let result:any=null,error:string|null=null;try{switch(op.op){
    case "join":g.join(op.id);break;case "leave":g.leave(op.id);break;case "aim":g.aim(op.id,op.angle,op.power);break;
    case "shoot":g.shoot(op.id,op.angle,op.power,op.revision??g.state.revision);break;
    case "place":g.place(op.id,op.x,op.z,op.revision??g.state.revision);break;case "restart":g.restart(op.id);break;
    case "steps":for(let i=0;i<op.count;i++)result=g.step();break;
    case "fixture":Object.assign(g.state,structuredClone(op.patch));break;default:throw Error("Unknown operation");
  }}catch(e){error=(e as Error).message;}
  steps.push({...op,result,error,state:structuredClone(g.state)});}
  function roll(){for(let i=0;i<30&&["preparing","rolling"].includes(g.state.phase);i++)step({op:"steps",count:120});if(["preparing","rolling"].includes(g.state.phase))throw Error("shot did not settle");}
  step({op:"join",id:"p0"});step({op:"join",id:"p1"});return {g,steps,step,roll};
}
scenario("natural-break-and-twenty-shots",a=>{
  a.step({op:"join",id:"spectator"});a.step({op:"aim",id:"p1",angle:0,power:1});a.step({op:"aim",id:"p0",angle:0,power:0});
  a.step({op:"aim",id:"p0",angle:0.025,power:0.8});a.step({op:"shoot",id:"p0",angle:0.025,power:0.8,revision:0});
  a.step({op:"shoot",id:"p0",angle:0.025,power:0.8});a.step({op:"steps",count:77});a.step({op:"steps",count:1});a.roll();
  for(let i=0;i<20&&a.g.state.phase!=="finished";i++){
    const id=a.g.state.players[a.g.state.turn];
    if(a.g.state.phase==="placing"){
      a.step({op:"place",id,x:1.25,z:2.3});
      let placed=false;
      for(let z=1.5;z>=-1.5&&!placed;z-=0.3)for(let x=-0.8;x<=0.8&&!placed;x+=0.3){a.step({op:"place",id,x,z});placed=a.g.state.phase==="aiming";}
      if(!placed)throw Error("cannot place");
    }
    a.step({op:"shoot",id,angle:(i*1.637)%6.28,power:0.1+(i%9)*0.1});a.roll();
  }
  a.step({op:"leave",id:"p0"});a.step({op:"restart",id:"p1"});a.step({op:"join",id:"p2"});
});
scenario("valid-pot-victory-and-rematch",a=>{
  const balls=a.g.state.balls.map(b=>({...b,sunk:b.id>1,x:b.id===1?0.82:0,z:0,vx:0,vz:0}));
  a.step({op:"fixture",patch:{balls,scores:[3,3]}});a.step({op:"shoot",id:"p0",angle:Math.PI/2,power:0.2});a.roll();
  if(a.g.state.phase!=="finished"||a.g.state.winner!=="p0")throw Error("controlled winning pot failed");
  a.step({op:"restart",id:"spectator"});a.step({op:"restart",id:"p0"});
});
scenario("wrong-first-contact-and-respot",a=>{
  const balls=a.g.state.balls.map(b=>({...b,sunk:b.id>2,x:b.id===2?0.82:b.id===1?-0.6:0,z:b.id===1?-1:0,vx:0,vz:0}));
  a.step({op:"fixture",patch:{balls}});a.step({op:"shoot",id:"p0",angle:Math.PI/2,power:0.2});a.roll();
  if(a.g.state.phase!=="placing"||a.g.state.balls[2].sunk)throw Error("wrong-contact respot failed");
  a.step({op:"place",id:"p0",x:0,z:0});a.step({op:"place",id:"p1",x:0,z:0});
});
scenario("scratch-and-abandonment",a=>{
  const balls=a.g.state.balls.map(b=>({...b,sunk:b.id>1,x:b.id===0?1.0:-0.5,z:b.id===0?0:-1,vx:0,vz:0}));
  a.step({op:"fixture",patch:{balls}});a.step({op:"shoot",id:"p0",angle:Math.PI/2,power:0.25});a.roll();
  if(a.g.state.phase!=="placing"||a.g.state.balls[0].sunk)throw Error("scratch respot failed");
  a.step({op:"leave",id:"p1"});a.step({op:"join",id:"p2"});a.step({op:"leave",id:"p2"});a.step({op:"leave",id:"p0"});
});
writeFileSync("evidence/native-2.0/functional/pool-fixtures.json",JSON.stringify({oracleSha256:createHash("sha256").update(readFileSync("src/shared/pool.ts")).digest("hex"),scenarios}));
console.log(JSON.stringify({scenarios:scenarios.length,steps:scenarios.reduce((n,s)=>n+s.steps.length,0),physicsSteps:scenarios.flatMap(s=>s.steps).filter(s=>s.op==="steps").reduce((n,s)=>n+s.count,0)}));
