'use client';

import { useState, useRef } from 'react';
import { Upload, CheckCircle, FileText, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { expandZipFiles } from '@/lib/client-unzip';

interface EvidenceChecklistItem {
  category: string;
  description: string;
  required: boolean;
}

interface EvidenceUploadListProps {
  engagementId: string;
  clientId: string;
  evidenceChecklist: EvidenceChecklistItem[];
  uploadedDocs: Record<string, boolean>;
  onDocumentUploaded: (category: string) => void;
}

export function EvidenceUploadList({
  engagementId,
  clientId,
  evidenceChecklist,
  uploadedDocs,
  onDocumentUploaded,
}: EvidenceUploadListProps) {
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  function handleUploadClick(category: string) {
    setActiveCategory(category);
    setUploadError(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeCategory) return;

    setUploadingCategory(activeCategory);
    setUploadError(null);

    try {
      // Expand any .zip files before uploading — each archive member becomes
      // its own upload.
      const expanded = await expandZipFiles(Array.from(files));
      const formData = new FormData();
      formData.append('engagementId', engagementId);
      formData.append('clientId', clientId);
      formData.append('documentCategory', activeCategory);
      for (const file of expanded) {
        formData.append('files', file);
      }

      const res = await fetch('/api/assurance/upload-evidence', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Upload failed');
      }

      onDocumentUploaded(activeCategory);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingCategory(null);
      setActiveCategory(null);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const requiredItems = evidenceChecklist.filter(i => i.required);
  const optionalItems = evidenceChecklist.filter(i => !i.required);
  const uploadedCount = Object.keys(uploadedDocs).length;
  const totalRequired = requiredItems.length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Upload className="h-4 w-4 text-blue-600" />
          Required Evidence Documents
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {uploadedCount} of {totalRequired} required documents uploaded
        </p>
        {/* Progress bar */}
        <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${totalRequired > 0 ? (uploadedCount / totalRequired) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.zip"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Error message */}
      {uploadError && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <X className="h-3 w-3" />
          {uploadError}
        </div>
      )}

      <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
        {/* Required documents */}
        {requiredItems.map((item) => {
          const isUploaded = uploadedDocs[item.category];
          const isUploading = uploadingCategory === item.category;
          return (
            <div
              key={item.category}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                isUploaded
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-white border-slate-200 hover:border-blue-300',
              )}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isUploaded ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                ) : (
                  <FileText className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-800">{item.category}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
              </div>
              {!isUploaded && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0 h-7 text-xs"
                  onClick={() => handleUploadClick(item.category)}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>
          );
        })}

        {/* Optional documents */}
        {optionalItems.length > 0 && (
          <>
            <div className="pt-2 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Optional</p>
            </div>
            {optionalItems.map((item) => {
              const isUploaded = uploadedDocs[item.category];
              const isUploading = uploadingCategory === item.category;
              return (
                <div
                  key={item.category}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                    isUploaded
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-white border-slate-100 hover:border-blue-300',
                  )}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {isUploaded ? (
                      <CheckCircle className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <FileText className="h-5 w-5 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700">{item.category}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{item.description}</p>
                  </div>
                  {!isUploaded && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-shrink-0 h-7 text-xs"
                      onClick={() => handleUploadClick(item.category)}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Upload className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
