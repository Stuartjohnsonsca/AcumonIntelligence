'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Pencil, Square, RotateCcw, Check, Loader2, Scissors, Camera } from 'lucide-react';

interface Props {
  engagementId: string;
  stepId: string;
  onCapture: (attachment: { id: string; name: string; storagePath: string }) => void;
  onClose: () => void;
}

type Tool = 'rect' | 'freehand';

export function ScreenCaptureModal({ engagementId, stepId, onCapture, onClose }: Props) {
  const [phase, setPhase] = useState<'waiting' | 'editing'>('waiting');
  const [tool, setTool] = useState<Tool>('rect');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [uploading, setUploading] = useState(false);

  const fullImageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const annotationSnapshotRef = useRef<ImageData | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load image into editor
  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.onload = () => {
      fullImageRef.current = img;
      setPhase('editing');
      annotationSnapshotRef.current = null;
    };
    img.src = src;
  }, []);

  // Poll clipboard for new image (auto-detect after Win+Shift+S)
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            loadImage(URL.createObjectURL(blob));
            return;
          }
        }
      } catch {
        // Clipboard read may fail silently — that's fine, keep polling
      }
    }, 600);
  }, [loadImage]);

  // Stop polling on unmount
  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  // Listen for Ctrl+V / Cmd+V paste
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          loadImage(URL.createObjectURL(blob));
          e.preventDefault();
          return;
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [loadImage]);

  // Start polling immediately on mount
  useEffect(() => { startPolling(); }, [startPolling]);

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
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = drawColor; ctx.lineWidth = 3; ctx.lineCap = 'round';
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawingRef.current || !startPosRef.current || !overlayRef.current) return;
    const pos = getPos(e);
    const start = startPosRef.current;
    const ctx = overlayRef.current.getContext('2d')!;
    if (tool === 'freehand') { ctx.lineTo(pos.x, pos.y); ctx.stroke(); }
    else if (tool === 'rect') {
      if (annotationSnapshotRef.current) ctx.putImageData(annotationSnapshotRef.current, 0, 0);
      else ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      ctx.strokeStyle = drawColor; ctx.lineWidth = 3;
      ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y);
    }
  };

  const onMouseUp = () => {
    drawingRef.current = false; startPosRef.current = null;
    if (overlayRef.current) annotationSnapshotRef.current = overlayRef.current.getContext('2d')!.getImageData(0, 0, overlayRef.current.width, overlayRef.current.height);
  };

  const clearAnnotations = () => {
    if (overlayRef.current) { overlayRef.current.getContext('2d')!.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height); annotationSnapshotRef.current = null; }
  };

  // Upload
  const upload = useCallback(async () => {
    if (!canvasRef.current) return;
    setUploading(true);
    const final = document.createElement('canvas');
    final.width = canvasRef.current.width; final.height = canvasRef.current.height;
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
        if (res.ok) { const d = await res.json(); onCapture({ id: d.id, name: d.name, storagePath: d.storagePath }); onClose(); }
      } catch (err) { console.error('Upload failed:', err); }
      finally { setUploading(false); }
    }, 'image/png');
  }, [engagementId, stepId, onCapture, onClose]);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
  const shortcutKey = isMac ? 'Cmd+Shift+4' : 'Win+Shift+S';

  // Read clipboard on user click (always allowed as user gesture)
  const pasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          loadImage(URL.createObjectURL(blob));
          return;
        }
      }
      alert('No image found in clipboard. Do Win+Shift+S first, then click here again.');
    } catch {
      alert('Clipboard access denied. Try pressing Ctrl+V instead.');
    }
  }, [loadImage]);

  // Waiting phase — snip prompt
  if (phase === 'waiting') {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center" onClick={onClose}>
        <div className="bg-slate-900 rounded-2xl shadow-2xl w-[420px] overflow-hidden text-center" onClick={e => e.stopPropagation()}>
          <div className="p-8">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
              <Scissors className="h-8 w-8 text-blue-400" />
            </div>
            <p className="text-white text-lg font-semibold mb-3">Snip your screen</p>
            <p className="text-slate-400 text-sm mb-5">Press <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-white">{shortcutKey}</kbd> and select the area, then:</p>
            <button onClick={pasteFromClipboard} className="w-full px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 transition-colors inline-flex items-center justify-center gap-2">
              <Camera className="h-5 w-5" /> Grab Screenshot
            </button>
            <p className="text-slate-500 text-[10px] mt-3">or press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-[9px] font-mono text-slate-300">Ctrl+V</kbd></p>
            <div className="flex items-center justify-center gap-2 text-blue-400/60 mt-3">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-[10px]">Also listening for clipboard changes...</span>
            </div>
          </div>
          <div className="px-6 py-3 bg-slate-800/50 border-t border-slate-700">
            <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // Editing phase
  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex flex-col" onClick={onClose}>
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
        <button onClick={() => { setPhase('waiting'); startPolling(); }} className="text-[11px] px-2.5 py-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600">
          New Capture
        </button>
        <button onClick={upload} disabled={uploading} className="text-[11px] px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 inline-flex items-center gap-1">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {uploading ? 'Saving...' : 'Save & Attach'}
        </button>
        <button onClick={onClose} className="text-slate-400 hover:text-white ml-2"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="rounded shadow-2xl" />
          <canvas ref={overlayRef} className="absolute inset-0 cursor-crosshair"
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
        </div>
      </div>
    </div>
  );
}
