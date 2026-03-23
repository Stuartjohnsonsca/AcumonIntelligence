'use client';

import { useState, useEffect, useCallback } from 'react';
import { Download, Upload, Loader2, CheckCircle, AlertCircle, FileText, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AssuranceChatWindow, type ChatMessage } from './AssuranceChatWindow';
import { EvidenceUploadList } from './EvidenceUploadList';
import { BoardReportView } from './BoardReportView';
import { CLIENT_SECTORS } from '@/lib/sectors';

interface ToRSection {
  title: string;
  content: string;
}

interface EvidenceChecklistItem {
  category: string;
  description: string;
  required: boolean;
}

interface TermsOfReferenceViewProps {
  engagementId: string;
  clientId: string;
  clientName: string;
  clientSector?: string | null;
  subToolKey: string;
  subToolName: string;
  chatId: string | null;
  messages: ChatMessage[];
  onSendMessage: (message: string) => Promise<void>;
  isLoading: boolean;
}

export function TermsOfReferenceView({
  engagementId,
  clientId,
  clientName,
  clientSector,
  subToolKey,
  subToolName,
  chatId,
  messages,
  onSendMessage,
  isLoading,
}: TermsOfReferenceViewProps) {
  const [sector, setSector] = useState(clientSector || '');
  const [torSections, setTorSections] = useState<ToRSection[]>([]);
  const [evidenceChecklist, setEvidenceChecklist] = useState<EvidenceChecklistItem[]>([]);
  const [keyRisks, setKeyRisks] = useState<string[]>([]);
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [torGenerated, setTorGenerated] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, boolean>>({});
  const [reviewComplete, setReviewComplete] = useState(false);
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Load existing ToR data if engagement already has it
  useEffect(() => {
    loadEngagement();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  async function loadEngagement() {
    try {
      const res = await fetch(`/api/assurance/engagement?engagementId=${engagementId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.termsOfReference) {
          const tor = JSON.parse(data.termsOfReference);
          setTorSections(tor.sections || []);
          setEvidenceChecklist(tor.evidenceChecklist || []);
          setKeyRisks(tor.keyRisks || []);
          setEstimatedDuration(tor.estimatedDuration || '');
          setTorGenerated(true);
        }
        if (data.sector) setSector(data.sector);
        if (data.status === 'complete') {
          setReviewComplete(true);
        }
      }
    } catch {
      // Ignore load errors
    }
  }

  async function handleGenerateToR() {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/assurance/generate-tor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, sector }),
      });

      if (!res.ok) throw new Error('Failed to generate ToR');

      const data = await res.json();
      setTorSections(data.sections);
      setEvidenceChecklist(data.evidenceChecklist);
      setKeyRisks(data.keyRisks);
      setEstimatedDuration(data.estimatedDuration);
      setTorGenerated(true);
    } catch (err) {
      console.error('ToR generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  const handleDocumentUploaded = useCallback((category: string) => {
    setUploadedDocs(prev => ({ ...prev, [category]: true }));
  }, []);

  async function handleDownloadToR() {
    setIsDownloading(true);
    try {
      const res = await fetch('/api/assurance/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, reportType: 'terms_of_reference' }),
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ToR_${clientName}_${subToolName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleReviewEvidence() {
    try {
      const res = await fetch('/api/assurance/review-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId }),
      });

      if (!res.ok) throw new Error('Failed to review evidence');

      const data = await res.json();
      setReportData(data);
      setReviewComplete(true);
    } catch (err) {
      console.error('Review error:', err);
    }
  }

  // If review is complete, show the board report
  if (reviewComplete && reportData) {
    return (
      <BoardReportView
        engagementId={engagementId}
        clientName={clientName}
        subToolName={subToolName}
        reportData={reportData}
      />
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="container mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">
                Terms of Reference &mdash; {subToolName}
              </p>
              <h1 className="text-xl font-bold text-slate-900">{clientName}</h1>
            </div>
            {torGenerated && (
              <Button onClick={handleDownloadToR} disabled={isDownloading} className="gap-2">
                {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download ToR PDF
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        {/* Chat continues at top */}
        <div className="mb-6">
          <AssuranceChatWindow
            chatId={chatId}
            clientId={clientId}
            messages={messages}
            onSendMessage={onSendMessage}
            isLoading={isLoading}
            welcomeMessage="I'm preparing the Terms of Reference for your engagement. Please confirm the client sector below, then I'll generate a tailored document."
            className="h-[250px]"
          />
        </div>

        {/* Sector Selection + Generate */}
        {!torGenerated && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Confirm Client Sector</h3>
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">Sector</label>
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select sector...</option>
                  {CLIENT_SECTORS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <Button onClick={handleGenerateToR} disabled={!sector || isGenerating} className="gap-2">
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" />
                    Generate Terms of Reference
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ToR Document + Evidence Upload Side by Side */}
        {torGenerated && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ToR Document - 2 columns */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Document Header */}
                <div className="bg-gradient-to-r from-blue-700 to-blue-900 p-6 text-white">
                  <div className="flex items-center gap-3 mb-2">
                    <img src="/logo-light.svg" alt="Acumon Intelligence" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                  <h2 className="text-xl font-bold">Terms of Reference</h2>
                  <p className="text-blue-200 text-sm mt-1">{subToolName} &mdash; {clientName}</p>
                  <p className="text-blue-300 text-xs mt-1">Estimated Duration: {estimatedDuration}</p>
                </div>

                {/* Contents */}
                <div className="border-b border-slate-200 p-4 bg-slate-50">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Contents</h3>
                  <ol className="text-xs text-slate-600 space-y-1">
                    {torSections.map((section, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-slate-400">{i + 1}.</span>
                        <a href={`#tor-section-${i}`} className="hover:text-blue-600 transition-colors">
                          {section.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Sections */}
                <div className="p-6 space-y-6">
                  {torSections.map((section, i) => (
                    <div key={i} id={`tor-section-${i}`}>
                      <h3 className="text-base font-semibold text-slate-900 mb-2">
                        {i + 1}. {section.title}
                      </h3>
                      <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {section.content}
                      </div>
                    </div>
                  ))}

                  {/* Key Risks */}
                  {keyRisks.length > 0 && (
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 mb-2">Key Risk Areas</h3>
                      <ul className="space-y-2">
                        {keyRisks.map((risk, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Evidence Upload - 1 column */}
            <div className="lg:col-span-1">
              <EvidenceUploadList
                engagementId={engagementId}
                clientId={clientId}
                evidenceChecklist={evidenceChecklist}
                uploadedDocs={uploadedDocs}
                onDocumentUploaded={handleDocumentUploaded}
              />

              {/* Review Button */}
              {Object.keys(uploadedDocs).length > 0 && (
                <div className="mt-4">
                  <Button
                    onClick={handleReviewEvidence}
                    className="w-full gap-2"
                    variant="default"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Review Uploaded Evidence
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
