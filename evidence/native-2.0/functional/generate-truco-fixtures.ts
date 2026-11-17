// Run: node --import tsx evidence/native-2.0/functional/generate-truco-fixtures.ts
// The preserved TypeScript implementation is the oracle, never part of the Rust runtime.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { TrucoGame, TRUCO_RANKS, TRUCO_SUITS, cardStrength, manilha, handWinner, type TrucoAction } from "../../../src/shared/truco";

const scenarios: any[] = [];
function scenario(name: string, run: (api: ReturnType<typeof setup>) => void) {
  const api = setup(name);
  run(api);
  scenarios.push({ name, seed: 918273, steps: api.steps });
}
function setup(name: string) {
  let seed = 918273, now = 100;
  const g = new TrucoGame(max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; });
  const steps: any[] = [];
  function step(operation: any) {
    let result: unknown = null, error: string | null = null;
    try {
      switch (operation.op) {
        case "join": g.join(operation.id, operation.now, operation.seat); break;
        case "leave": g.leave(operation.id); break;
        case "advance": result = g.advance(operation.now); break;
        case "sync": result = g.sync(new Set(operation.online), operation.now); break;
        case "act": g.act(operation.id, operation.action, operation.revision, operation.now); break;
        default: throw Error("unknown operation");
      }
    } catch (e) { error = (e as Error).message; }
    steps.push({ ...operation, result, error, views: [undefined, "p0", "p1", "p2", "p3"].map(id => g.view(id)) });
  }
  function advance(delta = 10000) { now += delta; step({ op: "advance", now }); }
  function act(seat: number, action: TrucoAction, revision?: number) {
    now = Math.max(now + 1, g.view().actionAt);
    step({ op: "advance", now });
    step({ op: "act", id: "p" + seat, action, revision: revision ?? g.revision, now });
  }
  function next() { for (let i=0; i<4 && ["dealing","trick-result","hand-result"].includes(g.phase); i++) advance(); }
  function point(team: number) {
    next(); let s = g.view();
    if (s.phase === "eleven") { act(s.eleven!, { type: "eleven", accept: false }); return; }
    if (s.turn % 2 !== team) act(s.turn, {type:"play",index:0});
    s = g.view();
    if (s.turn % 2 !== team) throw Error(name + ": invalid point helper");
    act(s.turn,{type:"raise"}); act(1-team,{type:"fold"});
  }
  for(let i=0;i<4;i++)step({op:"join",id:"p"+i,now,seat:i});
  advance(4000);
  return {g,steps,step,advance,act,next,point,get now(){return now;}};
}
scenario("raises-and-folds", a => {
  a.act(1,{type:"play",index:0});
  a.act(0,{type:"play",index:0,covered:true});
  a.act(0,{type:"raise"}); a.act(2,{type:"accept"});
  a.act(1,{type:"raise"}); a.act(0,{type:"raise"}); a.act(1,{type:"raise"});
  a.act(0,{type:"raise"}); a.act(0,{type:"fold"});
  a.next(); a.act(a.g.view().turn,{type:"raise"});
  const p=a.g.view().pending!;a.act(1-p.team,{type:"accept"});
  a.act(a.g.view().turn,{type:"raise"});
  a.act(a.g.view().turn,{type:"play",index:0});
  a.act(a.g.view().turn,{type:"play",index:0},0);
});
scenario("full-match-covered-and-eleven", a => {
  for(let i=0;i<1600 && a.g.phase!=="finished";i++) {
    a.next();const s=a.g.view();
    if(s.phase==="eleven") {a.act(1-s.eleven!,{type:"eleven",accept:true});a.act(s.eleven!,{type:"eleven",accept:true});a.act(s.eleven!,{type:"eleven",accept:true});a.act(s.eleven!+2,{type:"eleven",accept:true});}
    else if(s.phase==="playing") a.act(s.turn,{type:"play",index:0,covered:s.trick>0&&!s.iron&&i%5===0});
  }
  if(a.g.phase!=="finished")throw Error("match not finished");
  a.act(0,{type:"restart"});a.next();
});
scenario("eleven-iron-privacy", a => {
  for(let i=0;i<11;i++)a.point(0);
  for(let i=0;i<11;i++)a.point(1);
  a.next();
  if(!a.g.view().iron)throw Error("iron not reached");
  a.act(a.g.view().turn,{type:"raise"});a.act(a.g.view().turn,{type:"play",index:0,covered:true});
  for(let i=0;i<100&&a.g.phase!=="finished";i++){a.next();if(a.g.phase==="playing")a.act(a.g.view().turn,{type:"play",index:0});}
});
scenario("disconnect-reconnect-expire", a => {
  a.step({op:"sync",online:["p1","p2","p3"],now:a.now+100});
  a.act(0,{type:"play",index:0});
  a.step({op:"join",id:"intruder",seat:0,now:a.now+200});
  a.step({op:"sync",online:["p0","p1","p2","p3"],now:a.now+1500});
  a.step({op:"sync",online:["p1","p2","p3"],now:a.now+2000});
  a.step({op:"sync",online:["p1","p2","p3"],now:a.now+63000});
  a.step({op:"join",id:"p0",seat:0,now:a.now+64000});
  a.step({op:"sync",online:["p0","p1","p2","p3"],now:a.now+65000});
  a.act(1,{type:"restart"});
});
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const strengths=TRUCO_RANKS.flatMap(rank=>TRUCO_SUITS.flatMap(suit=>TRUCO_RANKS.flatMap(r=>TRUCO_SUITS.map(s=>({vira:{rank,suit},card:{rank:r,suit:s},strength:cardStrength({rank:r,suit:s},{rank,suit}),manilha:manilha({rank,suit})})))));
const ties:any[]=[];
function visit(tricks:(number|null)[]){const winner=handWinner(tricks);ties.push({tricks,complete:winner!==undefined,winner:winner??null});if(tricks.length<3)for(const value of [null,0,1])visit([...tricks,value]);}
visit([]);
writeFileSync("evidence/native-2.0/functional/truco-fixtures.json", JSON.stringify({oracle:{truco:hash("src/shared/truco.ts"),seats:hash("src/shared/gameSession.ts")},strengths,ties,scenarios}));
console.log(JSON.stringify({scenarios:scenarios.length,steps:scenarios.reduce((n,s)=>n+s.steps.length,0)}));
