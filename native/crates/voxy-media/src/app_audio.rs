//! Per-process audio capture (WASAPI process loopback, Windows 10 2004+).
//!
//! * `IncludeTree(pid)`: only the shared application and its child processes.
//! * `ExcludeTree(pid)`: everything except that process tree — used with the
//!   Voxy session process (which owns call playback) for monitor sharing.
//!
//! The OS mixes before handing samples over, so other applications are never
//! included in `IncludeTree` mode and the call is never re-captured in
//! `ExcludeTree` mode. Format: 48 kHz interleaved stereo f32.
use anyhow::{Context, Result, ensure};
use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
        Media::Audio::*,
        System::{
            Com::{
                BLOB,
                StructuredStorage::{
                    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
                },
            },
            Threading::{CreateEventW, WaitForSingleObject},
            Variant::VT_BLOB,
        },
    },
    core::{HRESULT, IUnknown, Interface, implement},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopbackMode {
    IncludeTree(u32),
    ExcludeTree(u32),
}

#[implement(
    IActivateAudioInterfaceCompletionHandler,
    windows::Win32::System::Com::IAgileObject
)]
struct Completion(std::sync::mpsc::SyncSender<()>);
impl windows::Win32::System::Com::IAgileObject_Impl for Completion_Impl {}
impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        _operation: windows::core::Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

pub struct ProcessAudioCapture {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    event: HANDLE,
}
// The COM objects are used only by the owning capture thread.
unsafe impl Send for ProcessAudioCapture {}

impl ProcessAudioCapture {
    /// The caller keeps `_runtime` (COM apartment) alive on this thread while capturing.
    pub fn start(_runtime: &crate::MediaRuntime, mode: LoopbackMode) -> Result<Self> {
        let (pid, loopback_mode) = match mode {
            LoopbackMode::IncludeTree(pid) => {
                (pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE)
            }
            LoopbackMode::ExcludeTree(pid) => {
                (pid, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE)
            }
        };
        ensure!(pid != 0, "Processo de áudio inválido");
        let mut parameters = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: loopback_mode,
                },
            },
        };
        // ManuallyDrop: PROPVARIANT's Drop runs PropVariantClear, which would try to
        // free this stack-owned blob.
        let variant = std::mem::ManuallyDrop::new(PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_BLOB,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        blob: BLOB {
                            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                            pBlobData: &mut parameters as *mut _ as *mut u8,
                        },
                    },
                }),
            },
        });
        let (done, completed) = std::sync::mpsc::sync_channel(1);
        let handler: IActivateAudioInterfaceCompletionHandler = Completion(done).into();
        let operation = unsafe {
            ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some(&*variant),
                &handler,
            )?
        };
        completed
            .recv_timeout(std::time::Duration::from_secs(5))
            .context("Ativação do áudio do processo não respondeu")?;
        let mut result = HRESULT(0);
        let mut interface: Option<IUnknown> = None;
        unsafe { operation.GetActivateResult(&mut result, &mut interface)? };
        result
            .ok()
            .context("Captura de áudio por processo indisponível neste Windows")?;
        let client: IAudioClient = interface.context("Cliente de áudio ausente")?.cast()?;
        let format = WAVEFORMATEX {
            wFormatTag: 3, // WAVE_FORMAT_IEEE_FLOAT
            nChannels: 2,
            nSamplesPerSec: 48_000,
            nAvgBytesPerSec: 48_000 * 8,
            nBlockAlign: 8,
            wBitsPerSample: 32,
            cbSize: 0,
        };
        unsafe {
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                200_000,
                0,
                &format,
                None,
            )?;
        }
        let event = unsafe { CreateEventW(None, false, false, None)? };
        let started = (|| -> Result<IAudioCaptureClient> {
            unsafe {
                client.SetEventHandle(event)?;
                let capture: IAudioCaptureClient = client.GetService()?;
                client.Start()?;
                Ok(capture)
            }
        })();
        match started {
            Ok(capture) => Ok(Self {
                client,
                capture,
                event,
            }),
            Err(error) => {
                unsafe {
                    let _ = CloseHandle(event);
                }
                Err(error)
            }
        }
    }
    /// Appends available interleaved stereo samples; waits up to `timeout_ms`.
    /// Returns the number of frames appended (silent packets become zeros).
    pub fn read(&mut self, output: &mut Vec<f32>, timeout_ms: u32) -> Result<usize> {
        if unsafe { WaitForSingleObject(self.event, timeout_ms) } != WAIT_OBJECT_0 {
            return Ok(0);
        }
        let mut total = 0;
        loop {
            let pending = unsafe { self.capture.GetNextPacketSize()? };
            if pending == 0 {
                break;
            }
            let mut data = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            unsafe {
                self.capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)?
            };
            let count = frames as usize * 2;
            ensure!(count <= 48_000 * 2, "Pacote de áudio excessivo");
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                output.extend(std::iter::repeat_n(0.0, count));
            } else {
                let samples = unsafe { std::slice::from_raw_parts(data as *const f32, count) };
                output.extend(samples.iter().map(|s| {
                    if s.is_finite() {
                        s.clamp(-1.0, 1.0)
                    } else {
                        0.0
                    }
                }));
            }
            unsafe { self.capture.ReleaseBuffer(frames)? };
            total += frames as usize;
        }
        Ok(total)
    }
}
impl Drop for ProcessAudioCapture {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
            let _ = CloseHandle(self.event);
        }
    }
}
