'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Crop, Pencil, Square, RotateCcw, Check, Loader2 } from 'lucide-react';

interface Props {
  engagementId: string;
  stepId: string;
  onCapture: (attachment: { id: string; name: string; storagePath: string }) => void;
  onClose: () => void;
}

type DrawMode = 'none' | 'crop' | 'rect' | 'freehand';

export function ScreenCaptureModal({ engagementId, stepId, onCapture, onClose }: Props) {
  const [phase, setPhase] = useState<'idle' | 'captured' | 'annotating' | 'uploading'>('idle');
  const [capturedImage, setCapturedImage] = useState<HTMLCanvasElement | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('crop');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const annotationsRef = useRef<ImageData | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Start screen capture
  const startCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } as any });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      // Wait a frame for video to render
      await new Promise(r => requestAnimationFrame(r));

      const canvas = document.createElement('canvas');
      canvas.width = settings.width || video.videoWidth;
      canvas.height = settings.height || video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);

      // Stop the stream
      stream.getTracks().forEach(t => t.stop());
      video.remove();

      setCapturedImage(canvas);
      setPhase('captured');
      setDrawMode('crop');
      setCropRect(null);
    } catch (err) {
      console.error('Screen capture failed:', err);
    }
  }, []);

  // Draw captured image to display canvas
  useEffect(() => {
    if (!capturedImage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const maxW = 900, maxH = 600;
    const scale = Math.min(maxW / capturedImage.width, maxH / capturedImage.height, 1);
    canvas.width = capturedImage.width * scale;
    canvas.height = capturedImage.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(capturedImage, 0, 0, canvas.width, canvas.height);

    // Init overlay canvas
    if (overlayRef.current) {
      overlayRef.current.width = canvas.width;
      overlayRef.current.height = canvas.height;
    }
  }, [capturedImage, phase]);

  // Mouse handlers for crop & draw
  const getPos = (e: React.MouseEvent) => {
    const rect = (overlayRef.current || canvasRef.current)!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const pos = getPos(e);
    drawStartRef.current = pos;

    if (drawMode === 'freehand' && overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawStartRef.current) return;
    const pos = getPos(e);
    const start = drawStartRef.current;

    if (drawMode === 'crop') {
      setCropRect({ x: Math.min(start.x, pos.x), y: Math.min(start.y, pos.y), w: Math.abs(pos.x - start.x), h: Math.abs(pos.y - start.y) });
    } else if (drawMode === 'freehand' && overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (drawMode === 'rect' && overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      // Restore previous state then draw new rect
      if (annotationsRef.current) ctx.putImageData(annotationsRef.current, 0, 0);
      else ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y);
    }
  };

  const onMouseUp = () => {
    if (drawMode === 'rect' || drawMode === 'freehand') {
      if (overlayRef.current) {
        annotationsRef.current = overlayRef.current.getContext('2d')!.getImageData(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
    }
    drawStartRef.current = null;
  };

  // Apply crop
  const applyCrop = useCallback(() => {
    if (!cropRect || !canvasRef.current || !capturedImage) return;
    const scale = capturedImage.width / canvasRef.current.width;
    const cropped = document.createElement('canvas');
    cropped.width = cropRect.w * scale;
    cropped.height = cropRect.h * scale;
    const ctx = cropped.getContext('2d')!;
    ctx.drawImage(capturedImage, cropRect.x * scale, cropRect.y * scale, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    setCapturedImage(cropped);
    setCropRect(null);
    setPhase('annotating');
    setDrawMode('rect');
    annotationsRef.current = null;
  }, [cropRect, capturedImage]);

  // Clear annotations
  const clearAnnotations = () => {
    if (overlayRef.current) {
      overlayRef.current.getContext('2d')!.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      annotationsRef.current = null;
    }
  };

  // Upload final image
  const upload = useCallback(async () => {
    if (!canvasRef.current) return;
    setUploading(true);

    // Flatten annotations onto canvas
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvasRef.current.width;
    finalCanvas.height = canvasRef.current.height;
    const ctx = finalCanvas.getContext('2d')!;
    ctx.drawImage(canvasRef.current, 0, 0);
    if (overlayRef.current) ctx.drawImage(overlayRef.current, 0, 0);

    finalCanvas.toBlob(async (blob) => {
      if (!blob) { setUploading(false); return; }
      const formData = new FormData();
      formData.append('file', blob, `capture_${Date.now()}.png`);
      formData.append('engagementId', engagementId);
      formData.append('stepId', stepId);

      try {
        const res = await fetch('/api/walkthrough/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          onCapture({ id: data.id, name: data.name, storagePath: data.storagePath });
          onClose();
        }
      } catch (err) {
        console.error('Upload failed:', err);
      } finally { setUploading(false); }
    }, 'image/png');
  }, [engagementId, stepId, onCapture, onClose]);

  // Auto-start capture on mount
  useEffect(() => { startCapture(); }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-[960px] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">
              {phase === 'idle' ? 'Capturing Screen...' : phase === 'captured' ? 'Crop Region' : phase === 'annotating' ? 'Annotate & Save' : 'Uploading...'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        {/* Toolbar */}
        {(phase === 'captured' || phase === 'annotating') && (
          <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
            {phase === 'captured' && (
              <>
                <button onClick={() => setDrawMode('crop')} className={`text-[10px] px-2 py-1 rounded inline-flex items-center gap-1 ${drawMode === 'crop' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  <Crop className="h-3 w-3" /> Crop
                </button>
                {cropRect && cropRect.w > 10 && (
                  <button onClick={applyCrop} className="text-[10px] px-2 py-1 bg-green-600 text-white rounded inline-flex items-center gap-1 hover:bg-green-700">
                    <Check className="h-3 w-3" /> Apply Crop
                  </button>
                )}
                <span className="text-slate-300">|</span>
                <button onClick={() => { setCropRect(null); setPhase('annotating'); setDrawMode('rect'); }} className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">
                  Skip Crop
                </button>
              </>
            )}
            {phase === 'annotating' && (
              <>
                <button onClick={() => setDrawMode('rect')} className={`text-[10px] px-2 py-1 rounded inline-flex items-center gap-1 ${drawMode === 'rect' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  <Square className="h-3 w-3" /> Rectangle
                </button>
                <button onClick={() => setDrawMode('freehand')} className={`text-[10px] px-2 py-1 rounded inline-flex items-center gap-1 ${drawMode === 'freehand' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  <Pencil className="h-3 w-3" /> Freehand
                </button>
                <span className="text-slate-300">|</span>
                {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'].map(c => (
                  <button key={c} onClick={() => setDrawColor(c)} className={`w-5 h-5 rounded-full border-2 ${drawColor === c ? 'border-slate-800 scale-110' : 'border-slate-300'}`} style={{ backgroundColor: c }} />
                ))}
                <span className="text-slate-300">|</span>
                <button onClick={clearAnnotations} className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 inline-flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" /> Clear
                </button>
              </>
            )}
          </div>
        )}

        {/* Canvas area */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100 min-h-[300px] relative">
          {phase === 'idle' && (
            <div className="text-center text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p className="text-sm">Select a screen or window to share...</p>
            </div>
          )}
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="max-w-full rounded shadow-lg" />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 cursor-crosshair"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            />
            {/* Crop overlay */}
            {cropRect && phase === 'captured' && (
              <>
                <div className="absolute inset-0 bg-black/40 pointer-events-none" />
                <div className="absolute border-2 border-white border-dashed pointer-events-none" style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }} />
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between bg-slate-50">
          <button onClick={startCapture} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 inline-flex items-center gap-1">
            <Camera className="h-3 w-3" /> Recapture
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
            {(phase === 'annotating' || phase === 'captured') && (
              <button onClick={upload} disabled={uploading} className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {uploading ? 'Uploading...' : 'Save & Attach'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
