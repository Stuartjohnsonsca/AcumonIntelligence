'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Pencil, Square, RotateCcw, Check, Loader2, Scissors, Camera, Upload, Monitor, Image as ImageIcon } from 'lucide-react';

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

  // Load from a File (drag-drop or file input)
  const loadFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file (PNG, JPG, etc).');
      return;
    }
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    loadImage(URL.createObjectURL(file));
  }, [loadImage]);

  // One-click capture using the browser's screen-share API.  Asks the user to
  // pick a window/tab/screen, grabs ONE frame, then closes the stream.  This
  // bypasses the OS snipping tool entirely on browsers that support it
  // (Chrome, Edge, Safari 17+, Firefox 100+).
  const captureViaDisplayMedia = useCallback(async () => {
    const md = (typeof navigator !== 'undefined' ? navigator.mediaDevices : null) as MediaDevices | null;
    if (!md || typeof md.getDisplayMedia !== 'function') {
      alert('Your browser does not support in-app screen capture. Use the snipping tool (Win+Shift+S / Cmd+Shift+4) and paste, or upload a file.');
      return;
    }
    try {
      const stream = await md.getDisplayMedia({ video: true, audio: false } as DisplayMediaStreamOptions);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No video track');

      // Use ImageCapture if available (Chrome / Edge); otherwise fall back to
      // drawing the first video frame to a canvas.
      let blob: Blob | null = null;
      if (typeof (window as any).ImageCapture === 'function') {
        try {
          const ic = new (window as any).ImageCapture(track);
          blob = await ic.grabFrame().then((bm: ImageBitmap) => {
            const c = document.createElement('canvas');
            c.width = bm.width; c.height = bm.height;
            c.getContext('2d')!.drawImage(bm, 0, 0);
            return new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
          });
        } catch {
          blob = null;
        }
      }
      if (!blob) {
        // Fallback: render frame to canvas via video element
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        await new Promise(r => setTimeout(r, 200)); // settle
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d')!.drawImage(video, 0, 0);
        blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
      }

      // Stop the stream immediately so the user isn't left "sharing"
      track.stop();
      stream.getTracks().forEach(t => t.stop());

      if (blob) loadImage(URL.createObjectURL(blob));
    } catch (err: any) {
      // User cancelled the picker — silent
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return;
      console.error('getDisplayMedia capture failed:', err);
      alert(`Capture failed: ${err?.message || 'unknown'}`);
    }
  }, [loadImage]);

  // Drag-and-drop on the picker
  const [dragOver, setDragOver] = useState(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFromFile(file);
  }, [loadFromFile]);

  // File input ref for the upload-image button
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Waiting phase — four ways to provide a screenshot
  if (phase === 'waiting') {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h3 className="text-white text-base font-semibold">Add a screenshot</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drag-drop zone — visually highlights when something is dragged over */}
          <div className={`mx-6 mt-5 border-2 border-dashed rounded-xl px-6 py-5 text-center transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-500/10' : 'border-slate-700 bg-slate-800/40'
          }`}>
            <ImageIcon className={`h-7 w-7 mx-auto mb-2 ${dragOver ? 'text-blue-300' : 'text-slate-500'}`} />
            <p className="text-slate-300 text-sm font-medium">
              {dragOver ? 'Drop the image to add it' : 'Drag & drop an image here'}
            </p>
            <p className="text-slate-500 text-[11px] mt-1">PNG, JPG, GIF, WebP</p>
          </div>

          {/* Four explicit ways to provide an image */}
          <div className="px-6 py-5 grid grid-cols-2 gap-3">
            {/* 1. Capture this tab/window/screen */}
            <button
              onClick={captureViaDisplayMedia}
              className="flex items-start gap-3 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-left transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center flex-shrink-0">
                <Monitor className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold">Capture screen</p>
                <p className="text-slate-400 text-[11px] mt-0.5">Pick a window or tab to grab. No external tool needed.</p>
              </div>
            </button>

            {/* 2. Upload an image file */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-start gap-3 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-left transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center flex-shrink-0">
                <Upload className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold">Upload image</p>
                <p className="text-slate-400 text-[11px] mt-0.5">Choose a saved screenshot from your computer.</p>
              </div>
            </button>

            {/* 3. Paste from clipboard */}
            <button
              onClick={pasteFromClipboard}
              className="flex items-start gap-3 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-left transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-violet-500/20 text-violet-300 flex items-center justify-center flex-shrink-0">
                <Camera className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold">Paste from clipboard</p>
                <p className="text-slate-400 text-[11px] mt-0.5">If you&apos;ve already copied an image somewhere.</p>
              </div>
            </button>

            {/* 4. OS snipping tool */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 text-left">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center flex-shrink-0">
                <Scissors className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold">Snipping tool</p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-[9px] font-mono text-white">{shortcutKey}</kbd> then <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-[9px] font-mono text-white">Ctrl+V</kbd> here.
                </p>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFromFile(f); }}
          />

          <div className="px-6 py-3 bg-slate-800/50 border-t border-slate-700 flex items-center justify-between">
            <span className="text-slate-500 text-[10px] inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Listening for clipboard changes...
            </span>
            <button onClick={onClose} className="text-xs text-slate-400 hover:text-white">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // Editing phase — just the image + Save / Cancel
  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl shadow-2xl overflow-hidden max-w-[90vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          <canvas ref={canvasRef} className="rounded shadow-lg max-w-full" />
          <canvas ref={overlayRef} className="hidden" />
        </div>
        <div className="px-5 py-3 bg-slate-800 border-t border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-700">Cancel</button>
          <button onClick={upload} disabled={uploading} className="px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-50 inline-flex items-center gap-2">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {uploading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
