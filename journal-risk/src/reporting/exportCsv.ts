import fs from 'fs';
import { stringify } from 'csv-stringify/sync';
import type { JournalRiskResult } from '../types';

/**
 * Export scored journal risk results as a CSV file.
 */
export function exportJournalsCsv(
  results: JournalRiskResult[],
  outputPath: string
): void {
  const columns = [
    'journalId',
    'postedAt',
    'period',
    'isManual',
    'preparedByUserId',
    'approvedByUserId',
    'riskScore',
    'riskBand',
    'riskTags',
    'selected',
    'selectionLayer',
    'mandatory',
    'rationale',
  ];

  const rows = results.map((r) => ({
    journalId: r.journalId,
    postedAt: r.postedAt,
    period: r.period,
    isManual: r.isManual,
    preparedByUserId: r.preparedByUserId,
    approvedByUserId: r.approvedByUserId ?? '',
    riskScore: r.riskScore,
    riskBand: r.riskBand,
    riskTags: r.riskTags.join(';'),
    selected: r.selection.selected,
    selectionLayer: r.selection.selectionLayer,
    mandatory: r.selection.mandatory,
    rationale: r.selection.rationale,
  }));

  const csv = stringify(rows, { header: true, columns });
  fs.writeFileSync(outputPath, csv, 'utf-8');
}
