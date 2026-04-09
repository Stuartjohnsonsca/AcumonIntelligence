'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Crop, Pencil, Square, RotateCcw, Check, Loader2 } from 'lucide-react';

interface Props {
  engagementId: string;
  stepId: string;
  onCapture: (attachment: { id: string; name: string; storagePath: string }) => void;
  onClose: () => void;
}

type Tool = 'crop' | 'rect' | 'freehand';

export function ScreenCaptureModal({ engagementId, stepId, onCapture, onClose }: Props) {
  const [phase, setPhase] = useState<'capturing' | 'editing' | 'uploading'>('capturing');
  const [renderKey, setRenderKey] = useState(0);
  const [tool, setTool] = useState<Tool>('crop');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [uploading, setUploading] = useState(false);

  // Full-resolution captured image (never scaled)
  const fullImageRef = useRef<HTMLImageElement | null>(null);
  // Displayed canvas (scaled to fit modal)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Annotation overlay (same size as display canvas)
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const drawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const annotationSnapshotRef = useRef<ImageData | null>(null);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Capture screen immediately
  const capture = useCallback(async () => {
    try {
      setPhase('capturing');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;

      // Wait for video to have actual dimensions and a rendered frame
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(() => {
            // Wait for at least one frame to be painted
            const checkFrame = () => {
              if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
              else requestAnimationFrame(checkFrame);
            };
            requestAnimationFrame(checkFrame);
          });
        };
      });

      // Small delay to ensure frame is fully rendered
      await new Promise(r => setTimeout(r, 200));

      // Grab frame at full resolution
      const w = video.videoWidth;
      const h = video.videoHeight;
      console.log('[ScreenCapture] Captured frame:', w, 'x', h);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);

      stream.getTracks().forEach(t => t.stop());
      video.remove();

      // Verify we got actual pixels
      if (w === 0 || h === 0) {
        console.error('[ScreenCapture] Captured 0-size frame');
        onClose();
        return;
      }

      // Convert to image for clean handling
      const dataUrl = canvas.toDataURL('image/png');
      const img = new Image();
      img.onload = () => {
        fullImageRef.current = img;
        setPhase('editing');
        setTool('crop');
        setCropBox(null);
        annotationSnapshotRef.current = null;
      };
      img.src = dataUrl;
    } catch (err) {
      console.error('Screen capture cancelled or failed:', err);
      onClose();
    }
  }, [onClose]);

  // Draw full image to display canvas (scaled to fit)
  useEffect(() => {
    if (phase !== 'editing' || !fullImageRef.current || !canvasRef.current) return;
    const img = fullImageRef.current;
    const canvas = canvasRef.current;

    // Render large enough that text is readable (min 75% of original, scrollable)
    // On high-DPI screens the captured image can be 2-3x viewport size,
    // so we cap at viewport width to keep it usable while allowing scroll
    const minScale = 0.75;
    const viewportScale = Math.min(window.innerWidth / img.width, 1);
    const scale = Math.max(viewportScale, minScale);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (overlayRef.current) {
      overlayRef.current.width = canvas.width;
      overlayRef.current.height = canvas.height;
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      annotationSnapshotRef.current = null;
    }
  }, [phase, renderKey]);

  // Mouse position relative to overlay
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
    if (!drawingRef.current || !startPosRef.current) return;
    const pos = getPos(e);
    const start = startPosRef.current;

    if (tool === 'crop') {
      setCropBox({
        x: Math.min(start.x, pos.x), y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x), h: Math.abs(pos.y - start.y),
      });
    } else if (tool === 'freehand' && overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (tool === 'rect' && overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
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
    if ((tool === 'rect' || tool === 'freehand') && overlayRef.current) {
      annotationSnapshotRef.current = overlayRef.current.getContext('2d')!.getImageData(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
  };

  // Apply crop — replace fullImage with cropped region at full resolution
  const applyCrop = useCallback(() => {
    if (!cropBox || !fullImageRef.current || !canvasRef.current) return;
    const displayScale = fullImageRef.current.width / canvasRef.current.width;
    const sx = Math.round(cropBox.x * displayScale);
    const sy = Math.round(cropBox.y * displayScale);
    const sw = Math.round(cropBox.w * displayScale);
    const sh = Math.round(cropBox.h * displayScale);

    const cropped = document.createElement('canvas');
    cropped.width = sw;
    cropped.height = sh;
    cropped.getContext('2d')!.drawImage(fullImageRef.current, sx, sy, sw, sh, 0, 0, sw, sh);

    const img = new Image();
    img.onload = () => {
      fullImageRef.current = img;
      setCropBox(null);
      setTool('rect');
      setRenderKey(k => k + 1); // Re-trigger canvas draw
    };
    img.src = cropped.toDataURL('image/png');
  }, [cropBox]);

  const clearAnnotations = () => {
    if (overlayRef.current) {
      overlayRef.current.getContext('2d')!.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      annotationSnapshotRef.current = null;
    }
  };

  // Upload — flatten annotations onto full-res image
  const upload = useCallback(async () => {
    if (!canvasRef.current || !fullImageRef.current) return;
    setUploading(true);

    // Build final at display resolution (includes annotations)
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

  // Auto-start capture
  useEffect(() => { capture(); }, []);

  if (phase === 'capturing' && !fullImageRef.current) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-2xl px-8 py-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-blue-500" />
          <p className="text-sm text-slate-600">Select a screen or window to capture...</p>
          <button onClick={onClose} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex flex-col" onClick={onClose}>
      {/* Toolbar */}
      <div className="shrink-0 bg-slate-900 px-4 py-2 flex items-center gap-3" onClick={e => e.stopPropagation()}>
        <Camera className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium text-white">Screen Capture</span>
        <span className="text-slate-500">|</span>

        <button onClick={() => { setTool('crop'); setCropBox(null); }} className={`text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1 ${tool === 'crop' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          <Crop className="h-3 w-3" /> Crop
        </button>
        {cropBox && cropBox.w > 10 && tool === 'crop' && (
          <button onClick={applyCrop} className="text-[11px] px-2.5 py-1 bg-green-600 text-white rounded inline-flex items-center gap-1 hover:bg-green-500">
            <Check className="h-3 w-3" /> Apply Crop
          </button>
        )}

        <span className="text-slate-600">|</span>

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

        <button onClick={capture} className="text-[11px] px-2.5 py-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 inline-flex items-center gap-1">
          <Camera className="h-3 w-3" /> Recapture
        </button>
        <button onClick={upload} disabled={uploading} className="text-[11px] px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 inline-flex items-center gap-1">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {uploading ? 'Saving...' : 'Save & Attach'}
        </button>
        <button onClick={onClose} className="text-slate-400 hover:text-white ml-2"><X className="h-5 w-5" /></button>
      </div>

      {/* Canvas area — full remaining viewport */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-2" onClick={e => e.stopPropagation()}>
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="rounded shadow-2xl" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0"
            style={{ cursor: tool === 'crop' ? 'crosshair' : tool === 'rect' ? 'crosshair' : 'default' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
          {/* Crop overlay */}
          {cropBox && tool === 'crop' && (
            <div className="absolute inset-0 pointer-events-none">
              <svg width="100%" height="100%" className="absolute inset-0">
                <defs>
                  <mask id="cropMask">
                    <rect width="100%" height="100%" fill="white" />
                    <rect x={cropBox.x} y={cropBox.y} width={cropBox.w} height={cropBox.h} fill="black" />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#cropMask)" />
              </svg>
              <div className="absolute border-2 border-white border-dashed" style={{ left: cropBox.x, top: cropBox.y, width: cropBox.w, height: cropBox.h }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
