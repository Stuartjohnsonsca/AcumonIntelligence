'use client';

import { useState } from 'react';
import { Download, Loader2, AlertTriangle, CheckCircle, ArrowRight, BarChart3, Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Recommendation {
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
}

interface Finding {
  area: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

interface DocumentReview {
  category: string;
  score: number;
  findings: Array<{ area: string; finding: string; severity: string }>;
  gaps: string[];
  recommendations: string[];
}

interface BoardReportViewProps {
  engagementId: string;
  clientName: string;
  subToolName: string;
  reportData: Record<string, unknown>;
}

const SEVERITY_COLORS = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};

const SEVERITY_ICONS = {
  high: AlertTriangle,
  medium: AlertTriangle,
  low: CheckCircle,
};

export function BoardReportView({
  engagementId,
  clientName,
  subToolName,
  reportData,
}: BoardReportViewProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const executiveSummary = String(reportData.executiveSummary || '');
  const recommendations = (reportData.recommendations || []) as Recommendation[];
  const findings = (reportData.findings || []) as Finding[];
  const nextSteps = (reportData.nextSteps || []) as string[];
  const overallScore = Number(reportData.overallScore || 0);
  const documentReviews = (reportData.documentReviews || []) as DocumentReview[];
  const benchmark = reportData.benchmark as { averageScore: number; sampleSize: number } | undefined;

  async function handleDownloadPDF() {
    setIsDownloading(true);
    try {
      const res = await fetch('/api/assurance/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, reportType: 'board_report' }),
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Board_Report_${clientName}_${subToolName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
    } finally {
      setIsDownloading(false);
    }
  }

  // Score colour
  function getScoreColor(score: number) {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  }

  function getScoreBg(score: number) {
    if (score >= 80) return 'bg-emerald-50 border-emerald-200';
    if (score >= 60) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">
              Board Report &mdash; {subToolName}
            </p>
            <h1 className="text-xl font-bold text-slate-900">{clientName}</h1>
          </div>
          <Button onClick={handleDownloadPDF} disabled={isDownloading} className="gap-2">
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download Board Report PDF
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        {/* Score + Benchmark Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className={cn('rounded-xl border-2 p-6 text-center', getScoreBg(overallScore))}>
            <Award className={cn('h-8 w-8 mx-auto mb-2', getScoreColor(overallScore))} />
            <p className={cn('text-4xl font-bold', getScoreColor(overallScore))}>{overallScore}</p>
            <p className="text-sm text-slate-600 mt-1">Overall Score /100</p>
          </div>

          {benchmark && (
            <div className="rounded-xl border-2 border-slate-200 bg-white p-6 text-center">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 text-blue-600" />
              <p className="text-4xl font-bold text-blue-600">{benchmark.averageScore}</p>
              <p className="text-sm text-slate-600 mt-1">Sector Average /100</p>
              <p className="text-xs text-slate-400">Based on {benchmark.sampleSize} engagements</p>
            </div>
          )}

          <div className="rounded-xl border-2 border-slate-200 bg-white p-6 text-center">
            <div className="flex items-center justify-center gap-4">
              <div>
                <p className="text-2xl font-bold text-red-600">
                  {findings.filter(f => f.severity === 'high').length}
                </p>
                <p className="text-xs text-slate-500">High</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">
                  {findings.filter(f => f.severity === 'medium').length}
                </p>
                <p className="text-xs text-slate-500">Medium</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">
                  {findings.filter(f => f.severity === 'low').length}
                </p>
                <p className="text-xs text-slate-500">Low</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mt-2">Finding Severity</p>
          </div>
        </div>

        {/* Report Content */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Cover */}
          <div className="bg-gradient-to-r from-blue-800 to-blue-950 p-8 text-white">
            <img src="/logo-light.svg" alt="Acumon Intelligence" className="h-10 mb-4" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <h2 className="text-2xl font-bold">Assurance Report</h2>
            <p className="text-blue-200 mt-1">{subToolName}</p>
            <p className="text-blue-300 text-sm mt-1">Prepared for: {clientName}</p>
            <p className="text-blue-400 text-xs mt-1">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>

          <div className="p-6 space-y-8">
            {/* Executive Summary */}
            <section>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Executive Summary</h3>
              <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                {executiveSummary}
              </div>
            </section>

            {/* Recommendations */}
            <section>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Recommendations</h3>
              <div className="space-y-3">
                {recommendations.map((rec, i) => {
                  const Icon = SEVERITY_ICONS[rec.priority];
                  return (
                    <div key={i} className={cn('flex items-start gap-3 p-3 rounded-lg border', SEVERITY_COLORS[rec.priority])}>
                      <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="text-xs font-semibold uppercase">{rec.priority} Priority</span>
                        <p className="text-sm mt-0.5">{rec.recommendation}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Detailed Findings */}
            <section>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Findings</h3>
              <div className="space-y-3">
                {findings.map((finding, i) => (
                  <div key={i} className={cn('p-3 rounded-lg border', SEVERITY_COLORS[finding.severity])}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold uppercase">{finding.severity}</span>
                      <span className="text-xs">&mdash;</span>
                      <span className="text-xs font-medium">{finding.area}</span>
                    </div>
                    <p className="text-sm">{finding.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Document Reviews Appendix */}
            <section>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Appendix A: Documents Reviewed</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 text-slate-500 font-medium">Document Category</th>
                      <th className="text-center py-2 text-slate-500 font-medium">Score</th>
                      <th className="text-center py-2 text-slate-500 font-medium">Findings</th>
                      <th className="text-center py-2 text-slate-500 font-medium">Gaps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documentReviews.map((review, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 text-slate-700">{review.category}</td>
                        <td className={cn('py-2 text-center font-medium', getScoreColor(review.score))}>
                          {review.score}/100
                        </td>
                        <td className="py-2 text-center text-slate-600">{review.findings.length}</td>
                        <td className="py-2 text-center text-slate-600">{review.gaps.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Next Steps */}
            <section>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Next Steps</h3>
              <div className="space-y-2">
                {nextSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <ArrowRight className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    {step}
                  </div>
                ))}
              </div>
            </section>

            {/* Caveats */}
            <section>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Appendix B: Caveats and Conditions</h3>
              <div className="text-xs text-slate-500 space-y-2 bg-slate-50 rounded-lg p-4">
                <p>This report has been prepared by Acumon Intelligence using AI-assisted analysis. While every effort has been made to ensure accuracy, the findings are based solely on the documents provided and the information available at the time of review.</p>
                <p>This report does not constitute legal, financial, or regulatory advice. Organisations should seek independent professional advice before making decisions based on these findings.</p>
                <p>The scoring methodology provides a relative assessment based on the evidence reviewed and should be considered alongside other assurance activities and professional judgement.</p>
                {!benchmark && (
                  <p>Benchmark comparisons are not available at this time due to insufficient comparable engagements. As more assurance engagements are completed across the sector, meaningful comparisons will become available.</p>
                )}
                <p>Acumon Intelligence is available to provide further assurance, advisory, and continuous improvement services to help your organisation strengthen its governance and compliance framework.</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
