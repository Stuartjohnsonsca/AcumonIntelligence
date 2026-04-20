'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Trash2, Save, ExternalLink, Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface Annotation {
  x: number; // percent (0-100) relative to document viewport
  y: number;
}

interface Props {
  evidence: {
    id: string;
    name: string;
    type: string;
    storagePath?: string;
    annotations?: Annotation[];
  };
  onClose: () => void;
  onSave: (annotations: Annotation[]) => void | Promise<void>;
}

function isImage(type: string, name: string) {
  if (type?.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(name);
}

function isPdf(type: string, name: string) {
  return type === 'application/pdf' || /\.pdf$/i.test(name);
}

export function DocumentAnnotator({ evidence, onClose, onSave }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>(evidence.annotations || []);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  function fitZoom() { setZoom(1); }
  function zoomIn() { setZoom(z => Math.min(z * 1.25, 5)); }
  function zoomOut() { setZoom(z => Math.max(z / 1.25, 0.5)); }

  const imageMode = isImage(evidence.type, evidence.name);
  const pdfMode = isPdf(evidence.type, evidence.name);

  // Load SAS URL for the document
  useEffect(() => {
    if (!evidence.storagePath) {
      setLoadingUrl(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/portal/download?storagePath=${encodeURIComponent(evidence.storagePath!)}`);
        if (res.ok) {
          const data = await res.json();
          setPreviewUrl(data.url);
        }
      } catch {}
      setLoadingUrl(false);
    })();
  }, [evidence.storagePath]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    setAnnotations(prev => [...prev, { x, y }]);
  }

  function removeAnnotation(idx: number) {
    setAnnotations(prev => prev.filter((_, i) => i !== idx));
  }

  function clearAll() {
    setAnnotations([]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(annotations);
      onClose();
    } catch (err) {
      console.error('[DocumentAnnotator] save failed', err);
    }
    setSaving(false);
  }

  // Annotation circle size scales inversely with zoom so the dot stays a
  // similar physical size on screen even after zooming the underlying
  // document. Base ~48px at zoom 1.
  const circleSize = Math.max(24, Math.round(48 / zoom));
  const circleBorder = Math.max(3, Math.round(5 / zoom));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2">
      <div className="bg-white rounded-lg shadow-2xl w-[98vw] h-[96vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 truncate">{evidence.name}</h3>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Zoom controls — only meaningful for images (PDF iframes have their own controls) */}
            {imageMode && (
              <div className="inline-flex items-center gap-0.5 border border-slate-200 rounded">
                <button onClick={zoomOut} className="px-1.5 py-1 hover:bg-slate-100" title="Zoom out">
                  <ZoomOut className="h-3.5 w-3.5 text-slate-600" />
                </button>
                <button onClick={fitZoom} className="px-2 py-1 hover:bg-slate-100 text-[10px] text-slate-600 font-medium min-w-[42px]" title="Fit to screen">
                  {Math.round(zoom * 100)}%
                </button>
                <button onClick={zoomIn} className="px-1.5 py-1 hover:bg-slate-100" title="Zoom in">
                  <ZoomIn className="h-3.5 w-3.5 text-slate-600" />
                </button>
              </div>
            )}
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 inline-flex items-center gap-1">
                <ExternalLink className="h-3 w-3" /> Open
              </a>
            )}
            {annotations.length > 0 && (
              <button onClick={clearAll}
                className="text-[10px] px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 inline-flex items-center gap-1">
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
            <button onClick={handleSave} disabled={saving}
              className="text-[10px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="px-4 py-1 bg-blue-50/50 border-b border-slate-200 text-[10px] text-slate-600 flex-shrink-0">
          Click anywhere on the document to place a red circle. Click an existing circle to remove it.
          {imageMode && <span className="ml-2 text-slate-400">Zoom in to place dots more precisely.</span>}
        </div>

        {/* Preview area — fills remaining space */}
        <div className="flex-1 overflow-auto bg-slate-100 p-4 min-h-0">
          {loadingUrl ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !evidence.storagePath ? (
            <div className="text-center py-20 text-sm text-slate-400">
              <p>This evidence has not been uploaded to storage yet.</p>
              <p className="text-xs text-slate-300 mt-2">Upload via the portal first to enable annotation.</p>
            </div>
          ) : !previewUrl ? (
            <div className="text-center py-20 text-sm text-slate-400">Failed to load preview</div>
          ) : imageMode ? (
            /* Image mode — fills the whole modal body. Zoom is applied via
               width style on the wrapper so percent-based annotation
               coordinates stay correct. */
            <div className="flex items-start justify-center min-h-full">
              <div ref={containerRef} onClick={handleClick}
                className="relative cursor-crosshair shadow-lg"
                style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}>
                <img src={previewUrl} alt={evidence.name}
                  className="block w-full h-auto select-none pointer-events-none" draggable={false} />
                {annotations.map((a, i) => (
                  <button key={i} onClick={(e) => { e.stopPropagation(); removeAnnotation(i); }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-red-500 bg-red-500/20 hover:bg-red-500/40 transition-colors"
                    style={{ left: `${a.x}%`, top: `${a.y}%`, width: circleSize, height: circleSize, borderWidth: circleBorder, borderStyle: 'solid' }}
                    title={`Annotation ${i + 1} — click to remove`} />
                ))}
              </div>
            </div>
          ) : pdfMode ? (
            /* PDF mode — iframe fills the modal body. Browser's native PDF
               viewer handles its own zoom/scroll; our overlay captures clicks
               at the iframe's *visible* coordinates. */
            <div className="relative w-full h-full" style={{ minHeight: '100%' }}>
              <iframe src={previewUrl} className="w-full h-full border-0 bg-white shadow-lg" title={evidence.name} />
              <div ref={containerRef} onClick={handleClick}
                className="absolute inset-0 cursor-crosshair">
                {annotations.map((a, i) => (
                  <button key={i} onClick={(e) => { e.stopPropagation(); removeAnnotation(i); }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-red-500 bg-red-500/20 hover:bg-red-500/40 transition-colors"
                    style={{ left: `${a.x}%`, top: `${a.y}%`, width: 48, height: 48, borderWidth: 5, borderStyle: 'solid' }}
                    title={`Annotation ${i + 1} — click to remove`} />
                ))}
              </div>
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 bg-white/80 px-2 py-1 rounded">
                Annotations are placed relative to this frame. Use the iframe&apos;s own zoom controls to enlarge the PDF.
              </p>
            </div>
          ) : (
            <div className="text-center py-20 text-sm text-slate-400">
              <p>Preview not supported for this file type.</p>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Download to view
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
