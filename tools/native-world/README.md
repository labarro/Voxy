# Catálogos e renderização nativa do mundo

O exportador executa os construtores procedurais originais de Lounge, Cinema e Rooftop **durante o desenvolvimento**, com os móveis GLB reais e Canvas nativo para gerar as texturas originais. Preserva todos os triângulos, normais, UVs, cores por vértice, transformações, materiais, luzes, fog, assentos e bounds de colisão em dados consumidos diretamente por Rust. Inclui as mesas físicas já construídas no legado; não troca os ambientes por cenários simplificados. A exportação de um avatar atual em repouso é uma referência de fidelidade geométrica; não equivale a personalização, skinning, rigging, animações ou IK nativos concluídos.

```powershell
cd tools/native-world
npm ci --ignore-scripts --no-audit --no-fund
npm run export
node verify.mjs
cd ../../native
cargo test --locked -p voxy-world
cargo run --locked -p voxy-world -- --preset lounge --validate
cargo run --locked -p voxy-world -- --preset rooftop
```

O executável `voxy-world.exe` é um processo opcional separado. `voxy-core`, sessão, voz e rede não dependem deste crate nem carregam suas texturas. Produção procura `world-assets` ao lado do executável; desenvolvimento também aceita a pasta de assets do workspace. `--assets` recebe um diretório explícito canonicalizado. Catálogos aceitam somente quatro presets conhecidos; referências internas recusam traversal e arquivos fora do diretório autorizado, verificam SHA-256 e impõem orçamentos de bytes, pixels, vértices, draws e objetos. Hashes detectam corrupção dos assets; a confiança criptográfica do pacote continua sendo responsabilidade do futuro instalador/atualizador assinado.

Controles da prévia: W/A/S/D deslocam a câmera, R/F sobem/descem, botão direito arrastado orbita, roda aproxima/afasta, F11 alterna fullscreen e Esc encerra. A janela desenha por eventos e fica sem timer de animação ociosa. `--frames 2` encerra automaticamente depois de dois frames. `--capture arquivo.png` grava um frame via readback GPU com timeout e encerra. `--ready-file arquivo.json` grava atomicamente `{preset,rendered:true,pid,adapter}` somente depois de o primeiro frame ter sido confirmado pela GPU; falhas retornam código não zero.

## Verificações executadas

`Scene::load` foi testado com os quatro catálogos reais, dimensões da tela, contagens de vértices, assentos, colisores, hierarquia e integridade dos buffers/texturas. Testes também rejeitam traversal e corrupção. As capturas `world-lounge.png`, `world-cinema.png`, `world-rooftop.png` e `world-avatar-rest.png` em `evidence/native-2.0/functional` vieram do renderer Rust/wgpu/DX12 na GPU reportada como **AMD Radeon(TM) Graphics**. Foram inspecionadas: ambiente completo é renderizado, e um defeito inicial que omitia cores por vértice dos cabelos/roupas foi corrigido. São evidências de renderização; não homologam estética, FPS, DPI, dispositivos de outros usuários ou multiplayer. `verify.mjs` gera um relatório reproduzível com hashes dos fontes e layout dos assets.

## Limites ainda abertos

O renderer inicial usa texturas sRGB, cores por vértice, luz difusa, emissivos, transparência e fog. O catálogo preserva roughness, metalness, bump maps, luzes e parâmetros de sombras, mas o shader ainda não reproduz todo o PBR/sombras/spotlights do legado. Sprites não têm billboard de câmera implementado. Colisores são dados preservados; caminhar com avatar, câmera com colisões e cortes de paredes, sentar/interagir, personalização dinâmica, skinning/IK/animações, multiplayer, voz espacial e vídeo/TV ao vivo continuam pendentes. Prévia de câmera livre não deve ser anunciada como mundo social funcional. Não há autoridade de partidas no processo de renderização.

## Licenças e fontes

Renderer usa [wgpu 27.0.1](https://docs.rs/crate/wgpu/27.0.1/source/LICENSE.MIT) (MIT/Apache-2.0), [winit 0.30.13](https://docs.rs/crate/winit/0.30.13/source/Cargo.toml) (Apache-2.0), [glam 0.30.9](https://docs.rs/crate/glam/0.30.9/source/Cargo.toml) (MIT/Apache-2.0), bytemuck 1.25.2 (Zlib/Apache-2.0/MIT), pollster 0.4.0 (MIT/Apache-2.0) e png 0.18 (MIT/Apache-2.0), travados no Cargo.lock. O pipeline de desenvolvimento usa Three.js já existente (MIT) e `@napi-rs/canvas` 1.1.1 (MIT, com componentes Skia sob seus próprios avisos), isolado nesta pasta; nenhum binário Node, JavaScript de runtime, Chromium ou WebView é distribuído pelo renderer. A licença original dos móveis CC0 é copiada junto aos assets. `NOTICE-Voxy.txt` registra a autoria e a declaração MIT dos manifests; como não existe LICENSE raiz, o aviso completo de copyright/licença precisa ser consolidado antes de distribuir. A revisão transitiva e o pacote de avisos final permanecem gates de distribuição.
