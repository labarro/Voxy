use anyhow::{Context,Result,ensure};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,path::Path};

#[derive(Debug,Clone,Copy)]
pub enum Preset {Lounge,Cinema,Rooftop,AvatarRest}
impl Preset {
    pub fn parse(value:&str)->Result<Self>{match value{"lounge"=>Ok(Self::Lounge),"cinema"=>Ok(Self::Cinema),"rooftop"=>Ok(Self::Rooftop),"avatar-default-rest"=>Ok(Self::AvatarRest),_=>anyhow::bail!("Ambiente desconhecido")}}
    pub fn name(self)->&'static str{match self{Self::Lounge=>"lounge",Self::Cinema=>"cinema",Self::Rooftop=>"rooftop",Self::AvatarRest=>"avatar-default-rest"}}
}
#[derive(Debug,Clone,Copy,bytemuck::Pod,bytemuck::Zeroable)]
#[repr(C)]
pub struct Vertex {pub position:[f32;3],pub normal:[f32;3],pub uv:[f32;2]}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Vertices {pub file:String,pub sha256:String,pub count:u32,pub stride:u32}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Draw {pub object:usize,pub name:String,pub instance:usize,pub start:u32,pub count:u32,pub material:usize,pub visible:bool,#[serde(rename="castShadow")]pub cast_shadow:bool,#[serde(rename="receiveShadow")]pub receive_shadow:bool,pub skinned:bool}
#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Material {pub name:String,#[serde(rename="type")]pub kind:String,pub color:[f32;3],pub opacity:f32,pub transparent:bool,pub roughness:f32,pub metalness:f32,pub emissive:[f32;3],pub emissive_intensity:f32,pub side:u8,pub depth_write:bool,pub unlit:bool,pub map:Option<usize>,pub bump_map:Option<usize>,pub bump_scale:f32,pub emissive_map:Option<usize>,pub tone_mapped:bool}
#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Texture {pub file:String,pub sha256:String,pub width:u32,pub height:u32,pub repeat:[f32;2],pub offset:[f32;2],pub rotation:f32,pub color_space:String,pub flip_y:bool}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Collider {pub name:String,#[serde(rename="type")]pub kind:String,pub min:[f32;3],pub max:[f32;3],#[serde(rename="matrixWorld")]pub matrix_world:[f32;16]}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Seat {pub id:String,pub x:f32,pub z:f32,pub yaw:f32,pub kind:String,pub game:Option<String>}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Fog {pub color:[f32;3],pub near:f32,pub far:f32}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Bounds {pub min:[f32;3],pub max:[f32;3]}
#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Light {pub name:String,#[serde(rename="type")]pub kind:String,pub color:[f32;3],pub ground_color:Option<[f32;3]>,pub intensity:f32,pub position:[f32;3],pub target:Option<[f32;3]>,pub distance:f32,pub decay:f32,pub angle:f32,pub penumbra:f32,pub cast_shadow:bool}
#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Object {pub id:usize,pub name:String,#[serde(rename="type")]pub kind:String,pub parent:Option<usize>,pub matrix:[f32;16],pub matrix_world:[f32;16],pub visible:bool}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Screen {pub position:[f32;3],pub width:f32,pub height:f32}
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Catalog {pub format:u32,pub name:String,pub oracle:BTreeMap<String,String>,pub vertices:Vertices,pub background:[f32;3],pub fog:Option<Fog>,pub bounds:Bounds,pub draws:Vec<Draw>,pub materials:Vec<Material>,pub textures:Vec<Texture>,pub lights:Vec<Light>,pub objects:Vec<Object>,pub colliders:Vec<Collider>,pub seats:Vec<Seat>,pub screen:Option<Screen>,pub limitations:Vec<String>}
pub struct Scene {pub catalog:Catalog,pub vertices:Vec<Vertex>,pub textures:Vec<Vec<u8>>}
fn asset(root:&Path,file:&str,hash:&str,max:u64)->Result<Vec<u8>>{
    ensure!(!file.is_empty()&&file.len()<100&&file.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b))&&!file.contains(".."),"Nome de asset inválido");
    ensure!(hash.len()==64&&hash.bytes().all(|b|b.is_ascii_hexdigit()),"Hash de asset inválido");
    let path=root.join(file);ensure!(std::fs::metadata(&path)?.len()<=max,"Asset excede o orçamento");let bytes=std::fs::read(path)?;ensure!(format!("{:x}",Sha256::digest(&bytes))==hash,"Asset corrompido");Ok(bytes)
}
impl Scene {
    pub fn load(root:&Path,preset:Preset)->Result<Self>{
        let path=root.join(format!("{}.scene.json",preset.name()));ensure!(std::fs::metadata(&path).context("Catálogo nativo não encontrado; execute o exportador de desenvolvimento")?.len()<=4*1024*1024,"Catálogo excede o orçamento");
        let catalog:Catalog=serde_json::from_slice(&std::fs::read(path)?)?;
        ensure!(catalog.format==1&&catalog.name==preset.name(),"Formato ou ambiente inválido");ensure!(catalog.vertices.stride==32&&catalog.vertices.count<=4_000_000,"Layout ou orçamento de vértices inválido");ensure!(catalog.draws.len()<=10_000&&catalog.materials.len()<=2000&&catalog.textures.len()<=1000&&catalog.objects.len()<=20_000&&catalog.lights.len()<=64,"Catálogo excede os limites");
        let binary=asset(root,&catalog.vertices.file,&catalog.vertices.sha256,128*1024*1024)?;
        ensure!(binary.len()==catalog.vertices.count as usize*32,"Buffer de vértices truncado");let vertices:Vec<Vertex>=binary.chunks_exact(32).map(bytemuck::pod_read_unaligned::<Vertex>).collect();
        ensure!(vertices.iter().all(|v|v.position.iter().chain(&v.normal).chain(&v.uv).all(|n|n.is_finite())),"Geometria não finita");
        for draw in &catalog.draws{ensure!(draw.start.checked_add(draw.count).is_some_and(|end|end<=catalog.vertices.count)&&draw.count%3==0&&draw.material<catalog.materials.len()&&draw.object<catalog.objects.len(),"Draw inválido");}
        for material in &catalog.materials{ensure!(material.color.iter().chain(&material.emissive).chain([material.opacity,material.roughness,material.metalness,material.emissive_intensity].iter()).all(|n|n.is_finite()),"Material não finito");for id in [material.map,material.bump_map,material.emissive_map].into_iter().flatten(){ensure!(id<catalog.textures.len(),"Textura desconhecida");}}
        for (id,object) in catalog.objects.iter().enumerate(){ensure!(object.id==id&&object.parent.is_none_or(|parent|parent<id)&&object.matrix.iter().chain(&object.matrix_world).all(|n|n.is_finite()),"Hierarquia ou transformação inválida");}
        for collider in &catalog.colliders{ensure!(collider.min.iter().zip(collider.max).all(|(min,max)|min.is_finite()&&max.is_finite()&&*min<=max),"Colisor inválido");}
        let mut textures=vec![];for texture in &catalog.textures{ensure!(texture.width>0&&texture.height>0&&texture.width<=4096&&texture.height<=4096,"Dimensão de textura inválida");textures.push(asset(root,&texture.file,&texture.sha256,16*1024*1024)?);}
        Ok(Self {catalog,vertices,textures})
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_procedural_geometry_materials_and_collisions_are_preserved(){
        let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../world-assets");
        for (preset,vertices,draws,colliders,seats) in [(Preset::Lounge,50934,334,32,15),(Preset::Cinema,50250,218,22,12),(Preset::Rooftop,92316,242,38,17),(Preset::AvatarRest,22026,28,0,0)]{
            let scene=Scene::load(&root,preset).unwrap();assert_eq!(scene.vertices.len(),vertices);assert_eq!(scene.catalog.draws.len(),draws);assert_eq!(scene.catalog.colliders.len(),colliders);assert_eq!(scene.catalog.seats.len(),seats);assert!(scene.catalog.materials.iter().all(|m|(0.0..=1.0).contains(&m.opacity)));
            if !matches!(preset,Preset::AvatarRest){let screen=scene.catalog.screen.unwrap();assert_eq!(screen.position,[0.0,3.15,-10.59]);assert_eq!(screen.width,7.8);assert_eq!(screen.height,4.3875);assert!(scene.catalog.colliders.iter().any(|c|c.min[0]<=-12.9||c.max[0]>=12.9));}
        }
    }
    #[test]
    fn corrupt_assets_and_path_traversal_are_rejected(){let dir=tempfile::tempdir().unwrap();assert!(asset(dir.path(),"../identity.bin",&"0".repeat(64),1024).is_err());std::fs::write(dir.path().join("asset.bin"),b"tampered").unwrap();assert!(asset(dir.path(),"asset.bin",&"0".repeat(64),1024).is_err());}
}
