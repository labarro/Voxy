// Build-time preservation of authored procedural scenes. No JS runtime is distributed.
import {createCanvas} from "@napi-rs/canvas";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,relative} from "node:path";
import {createHash} from "node:crypto";
import * as T from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {buildEnvironment} from "../../src/renderer/room3d/environment";
import {PoolTable} from "../../src/renderer/room3d/PoolTable";
import {TrucoTable} from "../../src/renderer/room3d/TrucoTable";
import {ChessTable} from "../../src/renderer/room3d/ChessTable";
import {seats,defaultAvatar} from "../../src/shared/room3d";
import {SocialAvatar} from "../../src/renderer/room3d/avatar";

const root=resolve(process.cwd(),"../..");
const output=resolve(root,"native/world-assets");mkdirSync(output,{recursive:true});
(globalThis as any).document={createElement:(tag:string)=>{if(tag!=="canvas")throw Error("Unexpected DOM dependency: "+tag);return createCanvas(1,1);}};
const hash=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const sources=["environment.ts","Rooftop.ts","resources.ts","avatar.ts","characterGeometry.ts","ArmIK.ts","PlayingCue.ts","PoolTable.ts","TrucoTable.ts","ChessTable.ts","ChessPieces.ts","CardDeck.ts"].map(name=>"src/renderer/room3d/"+name).concat(["src/shared/room3d.ts","src/shared/gameTables.ts","src/shared/pool.ts"]);
const oracle=Object.fromEntries(sources.map(path=>[path,hash(readFileSync(resolve(root,path)))]));
const models=new Map<string,T.Group>();
for(const name of ["tableCoffee","bookcaseOpenLow","books"]){const path=resolve(root,"src/renderer/public/assets/room3d/furniture/"+name+".glb");const bytes=readFileSync(path);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"");models.set(name,gltf.scene);oracle[relative(root,path).replaceAll("\\","/")]=hash(bytes);}
const assets={prop:(name:string)=>{const model=models.get(name);if(!model)throw Error("Missing real furniture asset: "+name);return model.clone(true);}} as any;

function bake(name:string,scene:T.Scene,environment?:ReturnType<typeof buildEnvironment>){
  scene.updateMatrixWorld(true);
  const objectIds=new Map<T.Object3D,number>();scene.traverse(object=>objectIds.set(object,objectIds.size));
  const chunks:Buffer[]=[],draws:any[]=[],materials:any[]=[],textures:any[]=[],lights:any[]=[],objects:any[]=[];
  const materialIds=new Map<T.Material,number>(),textureIds=new Map<T.Texture,number>();let vertexOffset=0;
  const texture=(tex:T.Texture|null|undefined)=>{if(!tex)return null;if(textureIds.has(tex))return textureIds.get(tex)!;const image=tex.image as any;if(!image?.toBuffer)throw Error("Texture is not authored canvas: "+tex.name);const bytes=image.toBuffer("image/png");const filename=hash(bytes)+".png";writeFileSync(resolve(output,filename),bytes);const index=textures.length;textureIds.set(tex,index);textures.push({file:filename,sha256:hash(bytes),width:image.width,height:image.height,repeat:tex.repeat.toArray(),offset:tex.offset.toArray(),rotation:tex.rotation,colorSpace:tex.colorSpace,flipY:tex.flipY});return index;};
  const material=(mat:any)=>{if(materialIds.has(mat))return materialIds.get(mat)!;const index=materials.length;materialIds.set(mat,index);materials.push({name:mat.name,type:mat.type,color:mat.color?.toArray()??[1,1,1],opacity:mat.opacity,transparent:mat.transparent,roughness:mat.roughness??1,metalness:mat.metalness??0,emissive:mat.emissive?.toArray()??[0,0,0],emissiveIntensity:mat.emissiveIntensity??0,side:mat.side,depthWrite:mat.depthWrite,unlit:mat instanceof T.MeshBasicMaterial||mat instanceof T.SpriteMaterial,map:texture(mat.map),bumpMap:texture(mat.bumpMap),bumpScale:mat.bumpScale??0,emissiveMap:texture(mat.emissiveMap),toneMapped:mat.toneMapped});return index;};
  let objectIndex=0;
  scene.traverse(object=>{const id=objectIndex++;const visible=(()=>{for(let o:T.Object3D|null=object;o;o=o.parent)if(!o.visible)return false;return true;})();
    objects.push({id,name:object.name,type:object.type,parent:object.parent?objectIds.get(object.parent)??null:null,matrix:object.matrix.toArray(),matrixWorld:object.matrixWorld.toArray(),visible});
    if(object instanceof T.Light){const light=object as any;lights.push({name:object.name,type:object.type,color:light.color.toArray(),groundColor:light.groundColor?.toArray(),intensity:light.intensity,position:object.getWorldPosition(new T.Vector3()).toArray(),target:light.target?.getWorldPosition(new T.Vector3()).toArray(),distance:light.distance??0,decay:light.decay??0,angle:light.angle??0,penumbra:light.penumbra??0,castShadow:light.castShadow??false});}
    if(!(object instanceof T.Mesh)&&!(object instanceof T.Sprite))return;
    const mesh=object as T.Mesh;const geometry=mesh.geometry??new T.PlaneGeometry(1,1);const positions=geometry.getAttribute("position");if(!positions)return;
    if(!geometry.getAttribute("normal"))geometry.computeVertexNormals();const normals=geometry.getAttribute("normal"),uv=geometry.getAttribute("uv"),index=geometry.index;
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];const groups=geometry.groups.length&&mats.length>1?geometry.groups:[{start:0,count:index?.count??positions.count,materialIndex:0}];
    const instances=mesh instanceof T.InstancedMesh?mesh.count:1;
    for(let instance=0;instance<instances;instance++){
      const transform=mesh.matrixWorld.clone();if(mesh instanceof T.InstancedMesh){const local=new T.Matrix4();mesh.getMatrixAt(instance,local);transform.multiply(local);}
      const normalMatrix=new T.Matrix3().getNormalMatrix(transform);
      for(const group of groups){const buffer=Buffer.alloc(group.count*44);const point=new T.Vector3(),normal=new T.Vector3();let slot=0;
        for(let j=group.start;j<group.start+group.count;j++){const k=index?index.getX(j):j;
          if(mesh instanceof T.SkinnedMesh)mesh.getVertexPosition(k,point);else point.fromBufferAttribute(positions,k);point.applyMatrix4(transform);normal.fromBufferAttribute(normals,k).applyNormalMatrix(normalMatrix);
          const colors=geometry.getAttribute("color"); const vertexColors=(mats[group.materialIndex??0] as any).vertexColors; const values=[...point.toArray(),...normal.toArray(),uv?.getX(k)??0,uv?.getY(k)??0,...(vertexColors&&colors?[colors.getX(k),colors.getY(k),colors.getZ(k)]:[1,1,1])];for(const value of values){if(!Number.isFinite(value))throw Error("Non-finite mesh");buffer.writeFloatLE(value,slot++*4);}
        }
        chunks.push(buffer);draws.push({object:id,name:mesh.name,instance,start:vertexOffset,count:group.count,material:material(mats[group.materialIndex??0]),visible,castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow,skinned:mesh instanceof T.SkinnedMesh});vertexOffset+=group.count;
      }
    }
  });
  const binary=Buffer.concat(chunks),binaryFile=name+".vertices.bin";writeFileSync(resolve(output,binaryFile),binary);
  const bounds=new T.Box3().setFromObject(scene);
  const colliders=environment?.colliders.map(object=>{const bounds=new T.Box3().setFromObject(object);return {name:object.name,type:object.type,min:bounds.min.toArray(),max:bounds.max.toArray(),matrixWorld:object.matrixWorld.toArray()};})??[];
  const catalog={format:2,name,oracle,vertices:{file:binaryFile,sha256:hash(binary),count:vertexOffset,stride:44},background:scene.background instanceof T.Color?scene.background.toArray():[0.02,0.03,0.04],fog:scene.fog?{color:scene.fog.color.toArray(),near:(scene.fog as T.Fog).near,far:(scene.fog as T.Fog).far}:null,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},draws,materials,textures,lights,objects,colliders,seats:environment?seats(name as any):[],screen:environment?{position:environment.screen.position.toArray(),width:7.8,height:4.3875}:null,limitations:["Native animation/IK/controller/stream textures not integrated; avatar geometry is a rest-pose preservation artifact.","Renderer lighting must be validated separately from the preserved mesh/material catalog."]};
  writeFileSync(resolve(output,name+".scene.json"),JSON.stringify(catalog));
  console.log(JSON.stringify({name,vertices:vertexOffset,draws:draws.length,materials:materials.length,textures:textures.length,colliders:colliders.length,bytes:binary.length}));
}
for(const preset of ["lounge","cinema","rooftop"] as const){const scene=new T.Scene();const env=buildEnvironment(scene,preset,assets);if(preset!=="cinema"){new PoolTable(scene,env.colliders);new TrucoTable(scene);new ChessTable(scene);}bake(preset,scene,env);env.dispose();}
const avatarScene=new T.Scene();const avatar=new SocialAvatar(assets,defaultAvatar);avatarScene.add(avatar.group);bake("avatar-default-rest",avatarScene);
writeFileSync(resolve(output,"sources.json"),JSON.stringify(oracle,null,2));
writeFileSync(resolve(output,"LICENSE-furniture.txt"),readFileSync(resolve(root,"src/renderer/public/assets/room3d/furniture/LICENSE.txt")));
writeFileSync(resolve(output,"NOTICE-Voxy.txt"),"Geometria procedural e texturas autorais geradas a partir do repositório Voxy. A licença declarada em package.json é MIT. Os hashes e caminhos de autoria constam em sources.json. O repositório não contém um arquivo LICENSE raiz; consolidar o aviso completo de copyright/licença antes da distribuição pública.\n");
