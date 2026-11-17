import {readFileSync,statSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
const root=resolve(import.meta.dirname,"../.."),directory=resolve(root,"native/world-assets");
const hash=data=>createHash("sha256").update(data).digest("hex");
const source=JSON.parse(readFileSync(resolve(directory,"sources.json"),"utf8"));
for(const[path,expected]of Object.entries(source))assert.equal(hash(readFileSync(resolve(root,path))),expected,`Source oracle changed: ${path}`);
const scenes=[];
for(const preset of ["lounge","cinema","rooftop","avatar-default-rest"]){
  const scene=JSON.parse(readFileSync(resolve(directory,preset+".scene.json"),"utf8"));
  assert.equal(scene.format,2);assert.equal(scene.vertices.stride,44);
  assert.equal(statSync(resolve(directory,scene.vertices.file)).size,scene.vertices.count*44);
  for(const entry of [scene.vertices,...scene.textures])assert.equal(hash(readFileSync(resolve(directory,entry.file))),entry.sha256,`Corrupted generated asset: ${entry.file}`);
  scenes.push({preset,vertices:scene.vertices.count,draws:scene.draws.length,materials:scene.materials.length,textures:scene.textures.length,colliders:scene.colliders.length,seats:scene.seats.length,meshBytes:scene.vertices.count*44});
}
const report={date:new Date().toISOString(),method:"Preserved procedural authoring sources baked into native asset data; checksum and layout verification, not physical gameplay approval",sources:Object.keys(source).length,scenes};
writeFileSync(resolve(root,"evidence/native-2.0/functional/world-catalog-verification.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
