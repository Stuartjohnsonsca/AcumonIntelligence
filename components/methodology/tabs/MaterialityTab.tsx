'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { useActionTriggers } from '@/hooks/useActionTriggers';
import type { TemplateQuestion } from '@/types/methodology';

interface Props {
  engagementId: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', JPY: '¥', CHF: 'Fr', CAD: 'C$', AUD: 'A$',
  CNY: '¥', INR: '₹', BRL: 'R$', ZAR: 'R', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RUB: '₽', TRY: '₺', MXN: '$', SGD: 'S$',
  HKD: 'HK$', NZD: 'NZ$', KRW: '₩', THB: '฿', AED: 'د.إ', SAR: '﷼',
};

function getCurrencySymbol(code: string | null | undefined): string {
  if (!code) return '';
  return CURRENCY_SYMBOLS[code.toUpperCase()] || code;
}

export function MaterialityTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [priorYearData, setPriorYearData] = useState<Record<string, unknown> | null>(null);
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const actionTriggers = useActionTriggers();
  const [reportingCurrency, setReportingCurrency] = useState<string | null>(null);
  const [materialityRange, setMaterialityRange] = useState<{ benchmark: string; low: number; high: number }[] | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [dataRes, templateRes, permRes, rangeRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/materiality`),
        fetch(`/api/methodology-admin/templates?templateType=materiality_questions&auditType=ALL`),
        fetch(`/api/engagements/${engagementId}/permanent-file`),
        fetch(`/api/methodology-admin/risk-tables?tableType=materiality_range`),
      ]);

      if (dataRes.ok) {
        const json = await dataRes.json();
        const d = (json.data || {}) as Record<string, unknown>;
        const flat: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d)) {
          if (!k.startsWith('__')) flat[k] = v;
        }
        setData(flat);
      }

      if (templateRes.ok) {
        const json = await templateRes.json();
        const items = json.template?.items || json.items || [];
        if (Array.isArray(items) && items.length > 0) {
          setQuestions(items as TemplateQuestion[]);
        }
      }

      // Get reporting currency from permanent file
      if (permRes.ok) {
        const permJson = await permRes.json();
        const sections = permJson.sections || [];
        for (const section of sections) {
          const sData = section.data || {};
          if (sData.reporting_currency) {
            setReportingCurrency(sData.reporting_currency);
            break;
          }
        }
      }

      // Get materiality range from methodology admin
      if (rangeRes.ok) {
        const rangeJson = await rangeRes.json();
        if (rangeJson.table?.data) {
          setMaterialityRange(rangeJson.table.data);
        }
      }
      // Load prior year materiality — find previous engagement for same client/auditType
      try {
        const engRes = await fetch(`/api/engagements/${engagementId}`);
        if (engRes.ok) {
          const engJson = await engRes.json();
          const eng = engJson.engagement;
          if (eng?.clientId && eng?.auditType) {
            const priorEngRes = await fetch(`/api/engagements?clientId=${eng.clientId}&auditType=${eng.auditType}&prior=true&currentEngagementId=${engagementId}`);
            if (priorEngRes.ok) {
              const priorEngJson = await priorEngRes.json();
              const priorEngId = priorEngJson.engagement?.id;
              if (priorEngId) {
                const priorMatRes = await fetch(`/api/engagements/${priorEngId}/materiality`);
                if (priorMatRes.ok) {
                  const priorMatJson = await priorMatRes.json();
                  const pd = (priorMatJson.data || {}) as Record<string, unknown>;
                  const priorFlat: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(pd)) {
                    if (!k.startsWith('__') && !k.startsWith('trigger_')) priorFlat[k] = v;
                  }
                  if (Object.keys(priorFlat).length > 0) setPriorYearData(priorFlat);
                }
              }
            }
          }
        }
      } catch {
        // Prior year data is optional
      }
    } catch (err) {
      console.error('Failed to load materiality:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Check materiality breach
  const materialityValue = data.materiality as number | null | undefined;
  const selectedBenchmark = data.materiality_benchmark as string | null | undefined;
  const benchmarkAmount = data.benchmark_amount as number | null | undefined;
  const materialityPct = (materialityValue && benchmarkAmount && benchmarkAmount !== 0)
    ? materialityValue / benchmarkAmount
    : null;

  let breachWarning: string | null = null;
  if (materialityRange && selectedBenchmark && materialityPct !== null) {
    const rangeRow = materialityRange.find(r =>
      r.benchmark.toLowerCase() === (selectedBenchmark || '').toLowerCase()
    );
    if (rangeRow) {
      if (materialityPct < rangeRow.low) {
        breachWarning = `Materiality (${(materialityPct * 100).toFixed(2)}%) is below the permitted range (${(rangeRow.low * 100).toFixed(1)}% - ${(rangeRow.high * 100).toFixed(1)}%) for ${rangeRow.benchmark}`;
      } else if (materialityPct > rangeRow.high) {
        breachWarning = `Materiality (${(materialityPct * 100).toFixed(2)}%) exceeds the permitted range (${(rangeRow.low * 100).toFixed(1)}% - ${(rangeRow.high * 100).toFixed(1)}%) for ${rangeRow.benchmark}`;
      }
    }
  }

  const currencySymbol = getCurrencySymbol(reportingCurrency);

  // Inject currency symbol into question labels that mention £
  const processedQuestions = questions.map(q => {
    if (!currencySymbol || currencySymbol === '£') return q;
    const newLabel = q.label.replace(/£/g, currencySymbol).replace(/\(£\s*\)/g, `(${currencySymbol})`);
    return { ...q, label: newLabel };
  });

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Materiality...</div>;

  if (questions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500">No questions configured for Materiality.</p>
        <p className="text-xs text-slate-400 mt-1">The Methodology Administrator needs to set up the Materiality schedule.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Currency indicator */}
      {reportingCurrency && (
        <div className="mb-3 text-xs text-slate-500">
          Reporting Currency: <span className="font-semibold text-slate-700">{reportingCurrency} ({currencySymbol})</span>
          <span className="text-slate-400 ml-2">— Set in Permanent File tab</span>
        </div>
      )}

      {/* Materiality breach warning */}
      {breachWarning && (
        <div className="mb-4 p-3 bg-red-50 border-2 border-red-300 rounded-lg flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <p className="text-sm font-semibold text-red-800">Materiality Range Breach</p>
            <p className="text-xs text-red-700 mt-0.5">{breachWarning}</p>
            <p className="text-[10px] text-red-500 mt-1">Review the materiality calculation or consult the Methodology Administrator.</p>
          </div>
        </div>
      )}

      <DynamicAppendixForm
        engagementId={engagementId}
        endpoint="materiality"
        questions={processedQuestions}
        initialData={data as Record<string, string | number | boolean | null>}
        currencySymbol={currencySymbol || undefined}
        priorYearData={priorYearData as Record<string, string | number | boolean | null> | null}
      />
    </div>
  );
}
