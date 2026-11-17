struct PointLight { position:vec4<f32>,color:vec4<f32> }
struct Camera { view_proj:mat4x4<f32>,eye:vec4<f32>,ambient:vec4<f32>,sun_dir:vec4<f32>,sun_color:vec4<f32>,fog_color:vec4<f32>,fog_distance:vec4<f32>,points:array<PointLight,8> }
struct Material { color:vec4<f32>,emissive:vec4<f32>,uv:vec4<f32>,flags:vec4<f32> }
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> material:Material;
@group(1) @binding(1) var albedo:texture_2d<f32>;
@group(1) @binding(2) var linear_sampler:sampler;
struct VertexIn { @location(0)position:vec3<f32>,@location(1)normal:vec3<f32>,@location(2)uv:vec2<f32>,@location(3)color:vec3<f32> }
struct VertexOut { @builtin(position)clip:vec4<f32>,@location(0)position:vec3<f32>,@location(1)normal:vec3<f32>,@location(2)uv:vec2<f32>,@location(3)color:vec3<f32> }
@vertex fn vs_main(vertex:VertexIn)->VertexOut {var result:VertexOut;result.clip=camera.view_proj*vec4(vertex.position,1.0);result.position=vertex.position;result.normal=vertex.normal;result.uv=vertex.uv;result.color=vertex.color;return result;}
@fragment fn fs_main(vertex:VertexOut,@builtin(front_facing)front:bool)->@location(0)vec4<f32>{
    let mapped_uv=vertex.uv*material.uv.xy+material.uv.zw;
    let tex=textureSample(albedo,linear_sampler,vec2(mapped_uv.x,select(mapped_uv.y,1.0-mapped_uv.y,material.flags.y>0.5)));
    var normal=normalize(vertex.normal);if(!front){normal= -normal;}
    var light=camera.ambient.rgb*(0.7+0.3*max(normal.y,0.0));
    light+=camera.sun_color.rgb*max(dot(normal,normalize(camera.sun_dir.xyz)),0.0);
    for(var i=0u;i<8u;i++){
        let delta=camera.points[i].position.xyz-vertex.position;let d=length(delta);
        let cutoff=camera.points[i].position.w;
        let atten=pow(max(0.0,1.0-d/max(cutoff,0.001)),2.0)/max(1.0,d*d);
        light+=camera.points[i].color.rgb*max(dot(normal,normalize(delta)),0.0)*atten;
    }
    if(material.flags.x>0.5){light=vec3(1.0);}
    let color=tex.rgb*material.color.rgb*vertex.color*light+material.emissive.rgb;
    let distance_to_camera=distance(camera.eye.xyz,vertex.position);
    let fog=clamp((distance_to_camera-camera.fog_distance.x)/max(0.01,camera.fog_distance.y-camera.fog_distance.x),0.0,1.0)*camera.fog_distance.z;
    return vec4(mix(color,camera.fog_color.rgb,fog),tex.a*material.color.a);
}
