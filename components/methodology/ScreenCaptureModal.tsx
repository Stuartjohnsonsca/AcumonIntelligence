'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Clipboard, Pencil, Square, RotateCcw, Check, Loader2, Scissors, Camera } from 'lucide-react';

interface Props {
  engagementId: string;
  stepId: string;
  onCapture: (attachment: { id: string; name: string; storagePath: string }) => void;
  onClose: () => void;
}

type Tool = 'rect' | 'freehand';

export function ScreenCaptureModal({ engagementId, stepId, onCapture, onClose }: Props) {
  const [phase, setPhase] = useState<'waiting' | 'editing' | 'uploading'>('waiting');
  const [tool, setTool] = useState<Tool>('rect');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [uploading, setUploading] = useState(false);
  const [extensionDetected] = useState(() => document.documentElement.hasAttribute('data-acumon-ext'));

  const fullImageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const annotationSnapshotRef = useRef<ImageData | null>(null);

  // Read image from clipboard
  const pasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            fullImageRef.current = img;
            setPhase('editing');
            annotationSnapshotRef.current = null;
          };
          img.src = url;
          return;
        }
      }
      alert('No image found in clipboard. Press Win+Shift+S first to capture a screen region.');
    } catch (err) {
      alert('Could not read clipboard. Please allow clipboard access or try Ctrl+V.');
    }
  }, []);

  // Listen for paste events (Ctrl+V)
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            fullImageRef.current = img;
            setPhase('editing');
            annotationSnapshotRef.current = null;
          };
          img.src = url;
          e.preventDefault();
          return;
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Fallback: getDisplayMedia with auto-capture after 3s countdown
  const screenCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;

      await new Promise<void>(resolve => {
        video.onloadedmetadata = () => video.play().then(() => {
          const check = () => { if (video.videoWidth > 0) resolve(); else requestAnimationFrame(check); };
          requestAnimationFrame(check);
        });
      });
      await new Promise(r => setTimeout(r, 300));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      stream.getTracks().forEach(t => t.stop());
      video.remove();

      if (canvas.width === 0) { onClose(); return; }

      const img = new Image();
      img.onload = () => {
        fullImageRef.current = img;
        setPhase('editing');
        annotationSnapshotRef.current = null;
      };
      img.src = canvas.toDataURL('image/png');
    } catch { /* user cancelled */ }
  }, [onClose]);

  // Extension one-click capture — instant, no dialog
  const extensionCapture = useCallback(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ACUMON_CAPTURE_RESULT' && event.data.dataUrl) {
        window.removeEventListener('message', handler);
        const img = new Image();
        img.onload = () => {
          fullImageRef.current = img;
          setPhase('editing');
          annotationSnapshotRef.current = null;
        };
        img.src = event.data.dataUrl;
      } else if (event.data?.type === 'ACUMON_CAPTURE_ERROR') {
        window.removeEventListener('message', handler);
        alert('Capture failed: ' + (event.data.error || 'Unknown error'));
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'ACUMON_CAPTURE_REQUEST' }, '*');
    setTimeout(() => window.removeEventListener('message', handler), 10000);
  }, []);

  // Auto-capture on mount if extension is installed — no dialog, instant
  useEffect(() => {
    if (extensionDetected) extensionCapture();
  }, [extensionDetected, extensionCapture]);

  // Draw image to display canvas
  useEffect(() => {
    if (phase !== 'editing' || !fullImageRef.current || !canvasRef.current) return;
    const img = fullImageRef.current;
    const canvas = canvasRef.current;
    const maxW = window.innerWidth - 80;
    const maxH = window.innerHeight - 160;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (overlayRef.current) {
      overlayRef.current.width = canvas.width;
      overlayRef.current.height = canvas.height;
      overlayRef.current.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      annotationSnapshotRef.current = null;
    }
  }, [phase]);

  // Drawing handlers
  const getPos = (e: React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (phase !== 'editing') return;
    const pos = getPos(e);
    startPosRef.current = pos;
    drawingRef.current = true;
    if (tool === 'freehand' && overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawingRef.current || !startPosRef.current || !overlayRef.current) return;
    const pos = getPos(e);
    const start = startPosRef.current;
    const ctx = overlayRef.current.getContext('2d')!;

    if (tool === 'freehand') {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (tool === 'rect') {
      if (annotationSnapshotRef.current) ctx.putImageData(annotationSnapshotRef.current, 0, 0);
      else ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y);
    }
  };

  const onMouseUp = () => {
    drawingRef.current = false;
    startPosRef.current = null;
    if (overlayRef.current) {
      annotationSnapshotRef.current = overlayRef.current.getContext('2d')!.getImageData(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
  };

  const clearAnnotations = () => {
    if (overlayRef.current) {
      overlayRef.current.getContext('2d')!.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      annotationSnapshotRef.current = null;
    }
  };

  // Upload
  const upload = useCallback(async () => {
    if (!canvasRef.current) return;
    setUploading(true);
    const final = document.createElement('canvas');
    final.width = canvasRef.current.width;
    final.height = canvasRef.current.height;
    const ctx = final.getContext('2d')!;
    ctx.drawImage(canvasRef.current, 0, 0);
    if (overlayRef.current) ctx.drawImage(overlayRef.current, 0, 0);

    final.toBlob(async (blob) => {
      if (!blob) { setUploading(false); return; }
      const formData = new FormData();
      formData.append('file', blob, `capture_${Date.now()}.png`);
      formData.append('engagementId', engagementId);
      formData.append('stepId', stepId);
      try {
        const res = await fetch('/api/walkthrough/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const d = await res.json();
          onCapture({ id: d.id, name: d.name, storagePath: d.storagePath });
          onClose();
        }
      } catch (err) { console.error('Upload failed:', err); }
      finally { setUploading(false); }
    }, 'image/png');
  }, [engagementId, stepId, onCapture, onClose]);

  // Waiting phase — if extension is capturing, show spinner; otherwise show options
  if (phase === 'waiting') {
    // Extension auto-capture in progress — just show a brief spinner
    if (extensionDetected) {
      return (
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
            <p className="text-xs text-slate-500">Capturing...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800">Capture Evidence</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-6 space-y-4">
            {/* Extension one-click capture (if detected) */}
            {extensionDetected && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <p className="text-[10px] text-green-600 font-medium mb-2 inline-flex items-center gap-1"><Camera className="h-3 w-3" /> Extension detected</p>
                <button onClick={extensionCapture} className="w-full px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 inline-flex items-center justify-center gap-2">
                  <Camera className="h-4 w-4" /> Capture Screen Now
                </button>
                <p className="text-[10px] text-green-500 mt-1.5">Instant capture of the current browser tab</p>
              </div>
            )}

            {/* Clipboard paste */}
            <div className={`${extensionDetected ? 'bg-slate-50 border-slate-200' : 'bg-blue-50 border-blue-200'} border rounded-lg p-4 text-center`}>
              {!extensionDetected && <p className="text-xs text-blue-700 font-semibold mb-2">Recommended</p>}
              <p className="text-[11px] text-slate-600 mb-3">Press <kbd className="px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono">Win + Shift + S</kbd> or <kbd className="px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono">Cmd + Shift + 4</kbd> to snip, then:</p>
              <button onClick={pasteFromClipboard} className={`px-4 py-2 ${extensionDetected ? 'bg-slate-600 hover:bg-slate-700' : 'bg-blue-600 hover:bg-blue-700'} text-white text-xs font-medium rounded-lg inline-flex items-center gap-2`}>
                <Clipboard className="h-4 w-4" /> Paste from Clipboard
              </button>
              <p className="text-[10px] text-slate-400 mt-2">Or just press <kbd className="px-1 py-0.5 bg-white border rounded text-[9px] font-mono">Ctrl+V</kbd> / <kbd className="px-1 py-0.5 bg-white border rounded text-[9px] font-mono">Cmd+V</kbd></p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-slate-200" />
              <span className="text-[10px] text-slate-400">or</span>
              <div className="flex-1 border-t border-slate-200" />
            </div>

            {/* Secondary: screen share */}
            <button onClick={screenCapture} className="w-full px-4 py-2.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200 inline-flex items-center justify-center gap-2">
              <Camera className="h-3.5 w-3.5" /> Full Screen Capture (browser dialog)
            </button>

            {/* Extension install prompt */}
            {!extensionDetected && (
              <div className="text-center pt-2 border-t border-slate-100">
                <p className="text-[10px] text-slate-400">Want one-click capture? <a href="/my-account?tab=tools" target="_blank" className="text-blue-500 hover:text-blue-700 underline">Install the Acumon Screen Capture extension</a></p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Editing phase
  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex flex-col" onClick={onClose}>
      {/* Toolbar */}
      <div className="shrink-0 bg-slate-900 px-4 py-2 flex items-center gap-3" onClick={e => e.stopPropagation()}>
        <Scissors className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium text-white">Annotate & Save</span>
        <span className="text-slate-500">|</span>

        <button onClick={() => setTool('rect')} className={`text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1 ${tool === 'rect' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          <Square className="h-3 w-3" /> Highlight
        </button>
        <button onClick={() => setTool('freehand')} className={`text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1 ${tool === 'freehand' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          <Pencil className="h-3 w-3" /> Draw
        </button>

        {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff'].map(c => (
          <button key={c} onClick={() => setDrawColor(c)} className={`w-5 h-5 rounded-full border-2 ${drawColor === c ? 'border-white scale-110' : 'border-slate-500'}`} style={{ backgroundColor: c }} />
        ))}

        <button onClick={clearAnnotations} className="text-[11px] px-2.5 py-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 inline-flex items-center gap-1 ml-1">
          <RotateCcw className="h-3 w-3" /> Clear
        </button>

        <div className="flex-1" />

        <button onClick={() => setPhase('waiting')} className="text-[11px] px-2.5 py-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600">
          New Capture
        </button>
        <button onClick={upload} disabled={uploading} className="text-[11px] px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 inline-flex items-center gap-1">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {uploading ? 'Saving...' : 'Save & Attach'}
        </button>
        <button onClick={onClose} className="text-slate-400 hover:text-white ml-2"><X className="h-5 w-5" /></button>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="rounded shadow-2xl" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 cursor-crosshair"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>
      </div>
    </div>
  );
}
