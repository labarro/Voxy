// Run: node --import tsx evidence/native-2.0/functional/generate-chess-fixtures.ts
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {ChessGame,type ChessAction} from "../../../src/shared/chess";
const scenarios:any[]=[];
function scenario(name:string,fen:string|undefined,run:(api:ReturnType<typeof setup>)=>void){const a=setup(fen);run(a);scenarios.push({name,fen:fen??null,steps:a.steps});}
function setup(fen?:string){
  const g=new ChessGame(fen),steps:any[]=[];let now=100;
  function step(op:any){let error:string|null=null;try{switch(op.op){
    case "join":g.join(op.id,op.now,op.seat);break;case "leave":g.leave(op.id);break;
    case "sync":g.sync(new Set(op.online),op.now);break;
    case "act":g.act(op.id,op.action,op.revision??g.revision,op.now);break;default:throw Error("Unknown operation");
  }}catch(e){error=(e as Error).message;}
  const views=[undefined,"white","black"].map(id=>g.view(id));
  // Legal move enumeration order is library-specific and has no game semantics.
  for(const view of views)for(const key of ["moves","claimMoves"] as const)view[key].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  steps.push({...op,error,views});}
  function act(seat:number,action:ChessAction){now=Math.max(now+1,g.actionAt);step({op:"sync",online:["white","black"],now});step({op:"act",id:seat?"black":"white",action,now});}
  function move(from:string,to:string,promotion?:"q"|"r"|"b"|"n"){act(g.view().turn,{type:"move",from,to,...(promotion?{promotion}:{})});}
  step({op:"join",id:"white",now,seat:0});step({op:"join",id:"black",now,seat:1});return {g,steps,step,act,move,get now(){return now;}};
}
scenario("turns-deadlines-mate",undefined,a=>{
  a.step({op:"act",id:"spectator",action:{type:"resign"},now:a.now+1});a.act(1,{type:"move",from:"e7",to:"e5"});a.move("e2","e5");a.move("f2","f3");
  a.step({op:"act",id:"black",action:{type:"move",from:"e7",to:"e5"},now:a.now+1});a.move("e7","e5");a.move("g2","g4");a.move("d8","h4");a.act(1,{type:"restart"});
});
scenario("castling", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",a=>{a.move("e1","g1");a.move("e8","c8");});
scenario("castling-through-check", "4kr2/8/8/8/8/8/8/4K2R w K - 0 1",a=>{a.move("e1","g1");a.move("e1","d1");});
scenario("en-passant",undefined,a=>{a.move("e2","e4");a.move("a7","a6");a.move("e4","e5");a.move("d7","d5");a.move("e5","d6");});
scenario("en-passant-expired",undefined,a=>{a.move("e2","e4");a.move("a7","a6");a.move("e4","e5");a.move("d7","d5");a.move("g1","f3");a.move("a6","a5");a.move("e5","d6");});
for(const promotion of ["q","r","b","n"] as const)scenario("promotion-"+promotion,"7k/P7/8/8/8/8/8/7K w - - 0 1",a=>{a.move("a7","a8");a.move("a7","a8",promotion);});
scenario("stalemate","7k/5K2/8/5Q2/8/8/8/8 w - - 0 1",a=>{a.move("f5","g6");});
scenario("insufficient-material","7k/8/8/8/8/8/2b5/KB6 w - - 0 1",a=>{a.move("b1","c2");});
scenario("threefold-claim",undefined,a=>{for(let i=0;i<2;i++){a.move("g1","f3");a.move("g8","f6");a.move("f3","g1");a.move("f6","g8");}a.act(0,{type:"claim"});});
scenario("claim-by-intended-move",undefined,a=>{for(let i=0;i<2;i++){a.move("g1","f3");a.move("g8","f6");a.move("f3","g1");if(i===0)a.move("f6","g8");}a.act(1,{type:"claim",move:{from:"f6",to:"g8"}});});
scenario("fivefold-automatic",undefined,a=>{for(let i=0;i<4;i++){a.move("g1","f3");a.move("g8","f6");a.move("f3","g1");a.move("f6","g8");}});
scenario("fifty-move-claim","7k/8/8/8/8/8/8/KR6 w - - 99 51",a=>{a.act(0,{type:"claim",move:{from:"b1",to:"b2"}});});
scenario("seventy-five-automatic","7k/8/8/8/8/8/8/KR6 w - - 149 76",a=>{a.move("b1","b2");});
scenario("agreement-reconnect-forfeit",undefined,a=>{
  a.act(0,{type:"offer"});a.move("e2","e4");a.act(0,{type:"offer"});a.act(0,{type:"accept"});a.act(1,{type:"decline"});a.act(0,{type:"offer"});a.act(1,{type:"accept"});a.act(1,{type:"restart"});
  a.step({op:"sync",online:["white"],now:a.now+100});a.step({op:"sync",online:["white","black"],now:a.now+1100});
  a.step({op:"sync",online:["white"],now:a.now+1200});a.step({op:"sync",online:["white"],now:a.now+62200});
  a.step({op:"join",id:"black",now:a.now+63000,seat:1});a.step({op:"sync",online:["white","black"],now:a.now+63100});a.act(0,{type:"restart"});a.act(0,{type:"resign"});
});
writeFileSync("evidence/native-2.0/functional/chess-fixtures.json",JSON.stringify({oracleSha256:createHash("sha256").update(readFileSync("src/shared/chess.ts")).digest("hex"),scenarios}));
console.log(JSON.stringify({scenarios:scenarios.length,steps:scenarios.reduce((n,s)=>n+s.steps.length,0),views:scenarios.reduce((n,s)=>n+s.steps.length*3,0)}));
