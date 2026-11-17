# voxy-media — captura Windows experimental

Backend nativo, separado do processo de voz e ainda **sem integração ao desktop/transporte**. Implementa seleção enumerável de janelas/monitores, Windows Graphics Capture, D3D11, frames BGRA8 compartilháveis e enumeração Media Foundation de metadados de câmeras. Não ativa a webcam, codifica vídeo, transmite mídia nem captura áudio.

## Contrato

1. Criar `MediaRuntime::new()` em uma thread MTA dedicada. O tipo não pode atravessar threads.
2. Usar `enumerate_sources()` e obter a seleção explícita do usuário. Handles de janela são conferidos com o PID antes de criar a captura.
3. `ScreenCapture::start(&runtime, &source, CaptureOptions::default())` mantém a borda de captura do sistema. O empréstimo exige que o runtime sobreviva à sessão.
4. `next_frame(timeout)` retorna `Result<Option<CaptureFrame>>`. `None` significa fonte sem frame novo no intervalo: manter a última imagem, sem transformar uma tela estática em erro de conexão. Fonte encerrada, dispositivo/GPU inválido e limites são erros explícitos.
5. `Drop` fecha sessão/pool, remove o handler, libera staging/contexto e seus recursos COM. A thread pode terminar quando não houver captura. Não manter o runtime de mídia dentro do core de voz sem necessidade.

O pool WGC contém dois frames; a leitura usa textura staging reutilizada, remove padding de `RowPitch`, trata resize por `ContentSize` e entrega o frame mais recente disponível. Frames CPU usam `Arc<[u8]>` para reutilização por preview/transporte/TV futura. Filas downstream ainda devem ser limitadas: reter todos os Arcs indefinidamente continua retendo memória. Há cópia GPU→CPU; este backend não promete zero-copy, encoder por hardware ou integração com TV.

FPS de entrega configurável de 1 a 60, BGRA8 até 8192 por eixo e 64 MiB por frame, timeout até dez segundos. Não há tone mapping HDR implementado. Não prometer fidelidade HDR, captura de conteúdo protegido, janelas minimizadas ou aplicações que bloqueiam captura.

`include_audio=true` é recusado com orientação para usar somente vídeo. Não existe fallback de mixagem de sistema que possa retransmitir a chamada. Process Loopback/isolamento do Voxy precisa ser implementado e validado antes de habilitar áudio compartilhado.

Factories WinRT são adquiridas sem cache estático e liberadas dentro do runtime: a prova de ciclo de vida encontrou acesso inválido ao reinicializar o MTA depois de usar factories globais da projeção. O teste cobre dois ciclos completos MTA/Media Foundation na mesma thread para impedir a regressão, além de reiniciar sessões de captura.

## Testes

```powershell
& "$env:USERPROFILE/.cargo/bin/cargo.exe" test --manifest-path native/Cargo.toml --locked -p voxy-media
& "$env:USERPROFILE/.cargo/bin/cargo.exe" test --manifest-path native/Cargo.toml --locked -p voxy-media --test capture_windows -- --ignored --nocapture
```

O segundo abre **somente uma janela de teste própria**, pinta conteúdo conhecido, verifica pixels/stride/timestamp, redimensiona a fonte e repete captura/liberação. Enumera metadados de câmera sem ativá-la; não salva frames nem captura monitores ou outras janelas. Isso é validação local real da API WGC/D3D11 sobre conteúdo sintético controlado, não homologação de webcam, jogos, streams, HDR, áudio ou redes físicas. O teste fica ignorado na suíte comum por alterar a superfície visual do sistema.

Referências primárias: [Microsoft — captura de tela](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture), [CreateFreeThreaded](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframepool.createfreethreaded), [enumeração de câmeras](https://learn.microsoft.com/en-us/windows/win32/medfound/enumerating-video-capture-devices). Bindings oficiais `windows` 0.62.2 fixados no Cargo.lock.

Pendentes: captura/encode/decode de webcam, encode/decode/timing de streams, transmissão/preview/UI, resolução de saída/adaptação, áudio seguro por processo, PiP/grade/fullscreen, compartilhamento de textura com mundo 3D, hotplug de dispositivos e medidas de GPU/VRAM/CPU em sessões longas. O monitor tem implementação de captura, mas sua validação foi deixada para seleção explícita em homologação para preservar o conteúdo pessoal da área de trabalho.
