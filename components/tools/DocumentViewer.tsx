'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FieldLocation {
  page: number;
  bbox: [number, number, number, number];
}

interface DocumentViewerProps {
  fileId: string;
  activeField: string | null;
  fieldLocations: Record<string, FieldLocation>;
  extractedValues: Record<string, unknown>;
  onClose: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  purchaserName: 'Purchaser Name',
  purchaserTaxId: 'Purchaser Tax ID',
  purchaserCountry: 'Purchaser Country',
  sellerName: 'Seller Name',
  sellerTaxId: 'Seller Tax ID',
  sellerCountry: 'Seller Country',
  documentRef: 'Document Ref',
  documentDate: 'Document Date',
  dueDate: 'Due Date',
  netTotal: 'Net Total',
  dutyTotal: 'Duty Total',
  taxTotal: 'Tax Total',
  grossTotal: 'Gross Total',
};

export function DocumentViewer({
  fileId,
  activeField,
  fieldLocations,
  extractedValues,
  onClose,
}: DocumentViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [highlightField, setHighlightField] = useState<string | null>(activeField);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isPdf, setIsPdf] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pdfDocRef = useRef<unknown>(null);

  useEffect(() => {
    async function fetchDoc() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/extraction/document/${fileId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load document');
        setDocUrl(data.url);
        setMimeType(data.mimeType || '');
        setPageCount(data.pageCount || 1);
        setIsPdf(data.mimeType === 'application/pdf');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    }
    fetchDoc();
  }, [fileId]);

  const renderPdfPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return;
    const pdf = pdfDocRef.current as { getPage: (n: number) => Promise<{
      getViewport: (opts: { scale: number }) => { width: number; height: number };
      render: (ctx: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
    }> };
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale * 1.5 });
    const canvas = canvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    setCanvasSize({ width: viewport.width, height: viewport.height });
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }, [scale]);

  useEffect(() => {
    if (!docUrl || !isPdf) return;
    let cancelled = false;

    async function loadPdf() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const loadingTask = pdfjsLib.getDocument(docUrl);
      const pdf = await loadingTask.promise;
      if (cancelled) return;
      pdfDocRef.current = pdf;
      setPageCount(pdf.numPages);
      await renderPdfPage(1);
    }

    loadPdf().catch(err => setError(err instanceof Error ? err.message : 'Failed to render PDF'));
    return () => { cancelled = true; };
  }, [docUrl, isPdf, renderPdfPage]);

  useEffect(() => {
    if (isPdf && pdfDocRef.current) {
      renderPdfPage(currentPage);
    }
  }, [currentPage, scale, isPdf, renderPdfPage]);

  useEffect(() => {
    if (!docUrl || isPdf) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight });
      setImageLoaded(true);
    };
    img.src = docUrl;
  }, [docUrl, isPdf]);

  useEffect(() => {
    if (highlightField) {
      const loc = fieldLocations[highlightField];
      if (loc) setCurrentPage(loc.page);
    }
  }, [highlightField, fieldLocations]);

  const pageLocations = Object.entries(fieldLocations).filter(([, loc]) => loc.page === currentPage);

  function getBoxStyle(fieldName: string, loc: FieldLocation): React.CSSProperties {
    const [yMin, xMin, yMax, xMax] = loc.bbox;
    const value = extractedValues[fieldName];
    const isActive = highlightField === fieldName;
    const isFailed = value === null || value === undefined;

    let borderColor = '#eab308'; // yellow
    let bgColor = 'rgba(234, 179, 8, 0.15)';
    if (isActive) {
      borderColor = '#2563eb'; // blue
      bgColor = 'rgba(37, 99, 235, 0.2)';
    } else if (isFailed) {
      borderColor = '#dc2626'; // red
      bgColor = 'rgba(220, 38, 38, 0.15)';
    }

    return {
      position: 'absolute',
      left: `${(xMin / 1000) * 100}%`,
      top: `${(yMin / 1000) * 100}%`,
      width: `${((xMax - xMin) / 1000) * 100}%`,
      height: `${((yMax - yMin) / 1000) * 100}%`,
      border: `2px solid ${borderColor}`,
      backgroundColor: bgColor,
      cursor: 'pointer',
      zIndex: isActive ? 10 : 5,
      borderRadius: '2px',
      transition: 'all 0.2s',
    };
  }

  const allFields = Object.keys(FIELD_LABELS);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex">
      {/* Sidebar */}
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 text-sm">Extracted Fields</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {allFields.map(field => {
            const value = extractedValues[field];
            const hasLocation = !!fieldLocations[field];
            const isActive = highlightField === field;
            const isFailed = value === null || value === undefined;

            return (
              <button
                key={field}
                onClick={() => setHighlightField(isActive ? null : field)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  isActive
                    ? 'bg-blue-100 border border-blue-300'
                    : isFailed
                      ? 'bg-red-50 hover:bg-red-100'
                      : 'hover:bg-slate-100'
                }`}
              >
                <div className="font-medium text-slate-600">{FIELD_LABELS[field] || field}</div>
                <div className={`truncate ${isFailed ? 'text-red-400 italic' : 'text-slate-800'}`}>
                  {isFailed ? 'Not extracted' : String(value)}
                </div>
                {!hasLocation && !isFailed && (
                  <span className="text-[10px] text-slate-400">No location data</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Document area */}
      <div className="flex-1 flex flex-col bg-slate-800">
        {/* Toolbar */}
        <div className="bg-slate-900 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {pageCount > 1 && (
              <>
                <Button size="sm" variant="ghost" className="text-white h-7"
                  disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-white text-xs">
                  Page {currentPage} / {pageCount}
                </span>
                <Button size="sm" variant="ghost" className="text-white h-7"
                  disabled={currentPage >= pageCount} onClick={() => setCurrentPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="text-white h-7"
              onClick={() => setScale(s => Math.max(0.5, s - 0.25))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-white text-xs w-12 text-center">{Math.round(scale * 100)}%</span>
            <Button size="sm" variant="ghost" className="text-white h-7"
              onClick={() => setScale(s => Math.min(3, s + 0.25))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="text-white h-7 ml-4" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Document content */}
        <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-8">
          {loading && (
            <div className="flex items-center gap-2 text-white mt-20">
              <Loader2 className="h-6 w-6 animate-spin" />Loading document...
            </div>
          )}
          {error && (
            <div className="bg-red-900/50 text-red-200 rounded-lg p-4 mt-20">{error}</div>
          )}
          {!loading && !error && (
            <div className="relative inline-block" style={{ transform: isPdf ? undefined : `scale(${scale})`, transformOrigin: 'top center' }}>
              {isPdf ? (
                <canvas ref={canvasRef} className="block shadow-2xl rounded" />
              ) : imageLoaded && imgRef.current ? (
                <img
                  src={docUrl}
                  alt="Document"
                  className="block shadow-2xl rounded max-w-none"
                  style={{ width: canvasSize.width * scale, height: canvasSize.height * scale }}
                  crossOrigin="anonymous"
                />
              ) : null}

              {/* Overlay boxes */}
              <div
                className="absolute inset-0"
                style={{ width: isPdf ? canvasSize.width : canvasSize.width * scale, height: isPdf ? canvasSize.height : canvasSize.height * scale }}
              >
                {pageLocations.map(([fieldName, loc]) => (
                  <div
                    key={fieldName}
                    style={getBoxStyle(fieldName, loc)}
                    onClick={() => setHighlightField(highlightField === fieldName ? null : fieldName)}
                    title={`${FIELD_LABELS[fieldName] || fieldName}: ${extractedValues[fieldName] ?? 'N/A'}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
