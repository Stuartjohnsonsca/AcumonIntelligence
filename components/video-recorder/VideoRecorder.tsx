'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoRecorderProps, RecorderResult } from './types';

// Reusable video/audio recorder.
//
// Uses the browser MediaRecorder API directly — no external deps. Handles:
//   - Permission request (camera + mic, or mic only in audio mode)
//   - Live preview (video mode)
//   - Start / stop / re-record
//   - Playback of the captured clip before confirmation
//   - Hard duration cap with auto-stop
//   - Optional POST to /api/transcribe for Whisper transcription
//
// The component does not persist the recording. On confirm, the blob is
// handed to the caller via onComplete and the component discards its internal
// reference. Callers that want retention should snapshot the blob themselves.

type Phase = 'idle' | 'permission' | 'ready' | 'recording' | 'review' | 'transcribing' | 'error';

export default function VideoRecorder({
  onComplete,
  onCancel,
  mode = 'video',
  transcribe = true,
  maxDurationSec = 300,
  prompt,
  theme = 'dark',
  allowDownload = true,
  downloadFilename = 'recording',
}: VideoRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef<HTMLVideoElement | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const recordedBlobRef = useRef<Blob | null>(null);
  const recordedMimeRef = useRef<string>('video/webm');

  // Determine mime type that both the browser supports and Whisper accepts.
  const pickMimeType = (wantVideo: boolean): string => {
    const candidates = wantVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const m of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return wantVideo ? 'video/webm' : 'audio/webm';
  };

  // Clean up stream and previews
  const teardownStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null;
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
  }, []);

  // Request permission and set up the preview stream
  const requestPermission = useCallback(async () => {
    setErrorMsg(null);
    setPhase('permission');
    try {
      // 720p target — more than enough for evidence review, keeps file
      // sizes manageable (a 2-minute clip lands around 15-25 MB).
      // Using ideal constraints so the browser can downgrade gracefully
      // on devices without HD-capable cameras.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: mode === 'video' ? {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 24, max: 30 },
        } : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      if (mode === 'video' && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        await videoPreviewRef.current.play().catch(() => {});
      }
      setPhase('ready');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unable to access media devices';
      setErrorMsg(msg);
      setPhase('error');
    }
  }, [mode]);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const wantVideo = mode === 'video';
    const mime = pickMimeType(wantVideo);
    recordedMimeRef.current = mime;
    try {
      // Constrain bitrates: 720p at ~1.2 Mbps video is plenty for evidence
      // review and transcription; 64 kbps Opus audio is transparent speech.
      const recOptions: MediaRecorderOptions = wantVideo
        ? { mimeType: mime, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 64_000 }
        : { mimeType: mime, audioBitsPerSecond: 64_000 };
      const rec = new MediaRecorder(streamRef.current, recOptions);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        recordedBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordedDuration(Math.round((Date.now() - startedAtRef.current) / 1000));
        setPhase('review');
      };
      rec.start(250);
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setPhase('recording');
      tickIntervalRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsedSec(secs);
        if (secs >= maxDurationSec) stopRecording();
      }, 250);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Recording failed to start';
      setErrorMsg(msg);
      setPhase('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, maxDurationSec]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
  }, []);

  const discardAndRetry = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setRecordedDuration(0);
    recordedBlobRef.current = null;
    setPhase('ready');
  }, [recordedUrl]);

  const confirmRecording = useCallback(async () => {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    const baseResult: RecorderResult = {
      blob,
      mimeType: recordedMimeRef.current,
      durationSec: recordedDuration,
    };
    if (!transcribe) {
      teardownStream();
      onComplete(baseResult);
      return;
    }
    setPhase('transcribing');
    try {
      const form = new FormData();
      // Name the file with an extension the server can pass through to Whisper
      const ext = recordedMimeRef.current.includes('mp4') ? 'mp4' : 'webm';
      form.append('file', blob, `recording.${ext}`);
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        teardownStream();
        onComplete({ ...baseResult, transcriptError: body?.error ?? `Transcription failed (${res.status})` });
        return;
      }
      const data = await res.json();
      teardownStream();
      onComplete({ ...baseResult, transcript: (data.text ?? '').trim() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transcription network error';
      teardownStream();
      onComplete({ ...baseResult, transcriptError: msg });
    }
  }, [recordedDuration, transcribe, onComplete, teardownStream]);

  const downloadRecording = useCallback(() => {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    const mime = recordedMimeRef.current;
    // Derive a sensible extension from the MIME subtype.
    const ext = (() => {
      if (mime.includes('mp4')) return 'mp4';
      if (mime.includes('ogg')) return 'ogg';
      if (mode === 'audio') return 'webm';
      return 'webm';
    })();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${downloadFilename}-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [mode, downloadFilename]);

  const cancelAll = useCallback(() => {
    stopRecording();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    recordedBlobRef.current = null;
    teardownStream();
    setPhase('idle');
    onCancel?.();
  }, [stopRecording, recordedUrl, teardownStream, onCancel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      teardownStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtClock = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Theme tokens
  const tokens = theme === 'dark' ? {
    bg: '#0A0A0A',
    panel: '#0D0D0D',
    border: '#1A1A1A',
    borderStrong: '#2A2A2A',
    textPrimary: '#E8E8E0',
    textSecondary: '#888',
    textDim: '#555',
    accent: '#6EC8E8',
    danger: '#C84040',
    success: '#6EC860',
    warn: '#E8A040',
  } : {
    bg: '#F4F4F2',
    panel: '#FFFFFF',
    border: '#E0E0DA',
    borderStrong: '#C0C0BA',
    textPrimary: '#181818',
    textSecondary: '#555',
    textDim: '#888',
    accent: '#1F78B4',
    danger: '#C84040',
    success: '#2E7D32',
    warn: '#E8A040',
  };

  return (
    <div className="rounded-lg p-4" style={{ background: tokens.panel, border: `1px solid ${tokens.border}` }}>
      {prompt && (
        <p className="text-sm leading-relaxed mb-4 italic" style={{ color: tokens.textSecondary, fontFamily: 'Georgia, serif' }}>
          {prompt}
        </p>
      )}

      {/* Idle — not yet requested permission */}
      {phase === 'idle' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="text-xs font-mono tracking-widest" style={{ color: tokens.textDim }}>
            {mode === 'video' ? 'VIDEO + AUDIO CAPTURE' : 'AUDIO CAPTURE'}
          </div>
          <p className="text-xs leading-relaxed max-w-md text-center" style={{ color: tokens.textSecondary }}>
            You will be asked for permission to access your {mode === 'video' ? 'camera and microphone' : 'microphone'}.
            Recording is sent for transcription; the text is the evidence input.
            {transcribe ? ' Transcript can be reviewed and edited before submission.' : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={requestPermission}
              className="px-5 py-2 rounded text-xs font-bold tracking-widest uppercase"
              style={{ background: tokens.accent, color: '#080808', border: 'none' }}
            >
              ● Start
            </button>
            {onCancel && (
              <button onClick={cancelAll} className="px-4 py-2 rounded text-xs font-mono tracking-wider" style={{ background: 'transparent', border: `1px solid ${tokens.borderStrong}`, color: tokens.textSecondary }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'permission' && (
        <div className="py-8 text-center text-xs font-mono tracking-widest" style={{ color: tokens.textDim }}>
          REQUESTING PERMISSION…
        </div>
      )}

      {(phase === 'ready' || phase === 'recording') && (
        <div className="flex flex-col gap-3">
          {mode === 'video' && (
            <div className="relative rounded overflow-hidden" style={{ background: '#000', aspectRatio: '16/9' }}>
              <video
                ref={videoPreviewRef}
                className="w-full h-full object-cover"
                playsInline
              />
              {phase === 'recording' && (
                <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 rounded" style={{ background: '#00000099', border: `1px solid ${tokens.danger}` }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: tokens.danger, animation: 'rfPulse 0.9s infinite' }} />
                  <span className="text-xs font-mono tracking-wider" style={{ color: tokens.danger }}>REC {fmtClock(elapsedSec)}</span>
                </div>
              )}
              <style>{`@keyframes rfPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
            </div>
          )}
          {mode === 'audio' && phase === 'recording' && (
            <div className="flex items-center gap-3 px-4 py-6 rounded justify-center" style={{ background: tokens.bg, border: `1px solid ${tokens.border}` }}>
              <div className="w-3 h-3 rounded-full" style={{ background: tokens.danger, animation: 'rfPulse 0.9s infinite' }} />
              <span className="text-lg font-mono tracking-wider" style={{ color: tokens.textPrimary }}>{fmtClock(elapsedSec)}</span>
              <span className="text-xs font-mono tracking-widest" style={{ color: tokens.textDim }}>RECORDING</span>
              <style>{`@keyframes rfPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
            </div>
          )}
          {mode === 'audio' && phase === 'ready' && (
            <div className="flex items-center justify-center py-6 text-xs font-mono tracking-widest" style={{ color: tokens.textDim }}>
              MICROPHONE READY
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-mono" style={{ color: tokens.textDim }}>
              Cap: {fmtClock(maxDurationSec)}
            </span>
            <div className="flex gap-2">
              {phase === 'ready' && (
                <>
                  <button
                    onClick={cancelAll}
                    className="px-3 py-1.5 rounded text-xs font-mono tracking-wider"
                    style={{ background: 'transparent', border: `1px solid ${tokens.borderStrong}`, color: tokens.textSecondary }}
                  >Cancel</button>
                  <button
                    onClick={startRecording}
                    className="px-5 py-1.5 rounded text-xs font-bold tracking-widest uppercase"
                    style={{ background: tokens.danger, color: '#FFF', border: 'none' }}
                  >● Record</button>
                </>
              )}
              {phase === 'recording' && (
                <button
                  onClick={stopRecording}
                  className="px-5 py-1.5 rounded text-xs font-bold tracking-widest uppercase"
                  style={{ background: tokens.warn, color: '#080808', border: 'none' }}
                >■ Stop</button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'review' && recordedUrl && (
        <div className="flex flex-col gap-3">
          {mode === 'video' ? (
            <video
              ref={playbackRef}
              src={recordedUrl}
              controls
              className="w-full rounded"
              style={{ background: '#000', maxHeight: 380 }}
            />
          ) : (
            <audio src={recordedUrl} controls className="w-full" />
          )}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-mono" style={{ color: tokens.textDim }}>
              Length: {fmtClock(recordedDuration)}
              {recordedBlobRef.current && (
                <span className="ml-2">· {Math.round(recordedBlobRef.current.size / 1024 / 1024 * 10) / 10} MB</span>
              )}
            </span>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={discardAndRetry}
                className="px-3 py-1.5 rounded text-xs font-mono tracking-wider"
                style={{ background: 'transparent', border: `1px solid ${tokens.borderStrong}`, color: tokens.textSecondary }}
              >Re-record</button>
              {allowDownload && (
                <button
                  onClick={downloadRecording}
                  className="px-3 py-1.5 rounded text-xs font-mono tracking-wider"
                  style={{ background: 'transparent', border: `1px solid ${tokens.accent}`, color: tokens.accent }}
                  title="Save recording to your device"
                >⬇ Download</button>
              )}
              <button
                onClick={confirmRecording}
                className="px-5 py-1.5 rounded text-xs font-bold tracking-widest uppercase"
                style={{ background: tokens.success, color: '#080808', border: 'none' }}
              >{transcribe ? 'Use & Transcribe →' : 'Use Recording →'}</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'transcribing' && (
        <div className="py-8 text-center">
          <div className="text-xs font-mono tracking-widest" style={{ color: tokens.accent }}>TRANSCRIBING…</div>
          <p className="text-xs mt-2" style={{ color: tokens.textDim }}>
            Processing audio for transcription. This typically takes 10–30 seconds.
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="py-6">
          <div className="text-xs font-mono tracking-widest mb-2" style={{ color: tokens.danger }}>ERROR</div>
          <p className="text-xs leading-relaxed mb-3" style={{ color: tokens.textSecondary }}>
            {errorMsg ?? 'Something went wrong.'}
          </p>
          <p className="text-xs leading-relaxed mb-4" style={{ color: tokens.textDim }}>
            Common causes: permission denied, no camera/microphone connected, or browser does not support MediaRecorder. On Safari, check Settings → Websites → Camera and Microphone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={requestPermission}
              className="px-4 py-1.5 rounded text-xs font-mono tracking-wider"
              style={{ background: tokens.accent, color: '#080808', border: 'none', fontWeight: 'bold' }}
            >Try again</button>
            <button
              onClick={cancelAll}
              className="px-4 py-1.5 rounded text-xs font-mono tracking-wider"
              style={{ background: 'transparent', border: `1px solid ${tokens.borderStrong}`, color: tokens.textSecondary }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
