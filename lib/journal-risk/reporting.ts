import type { JournalRiskResult, RunResult } from './types';

/**
 * Generate scored journal CSV as a string (no fs).
 */
export function generateScoredCsv(results: JournalRiskResult[]): string {
  const header = 'journalId,postedAt,period,isManual,preparedByUserId,approvedByUserId,riskScore,riskBand,riskTags,selected,selectionLayer,mandatory,rationale';

  const rows = results.map(r => {
    const fields = [
      r.journalId,
      r.postedAt,
      r.period,
      String(r.isManual),
      r.preparedByUserId,
      r.approvedByUserId ?? '',
      String(r.riskScore),
      r.riskBand,
      r.riskTags.join(';'),
      String(r.selection.selected),
      r.selection.selectionLayer,
      String(r.selection.mandatory),
      `"${(r.selection.rationale || '').replace(/"/g, '""')}"`,
    ];
    return fields.join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Generate markdown summary as a string (no fs).
 */
export function generateMarkdownSummary(runResult: RunResult): string {
  const pop = runResult.population;
  const journals = runResult.results.journals;

  let layer1 = 0, layer2 = 0, layer3 = 0, notSelected = 0;
  for (const j of journals) {
    switch (j.selection.selectionLayer) {
      case 'layer1_mandatory_high_risk': layer1++; break;
      case 'layer2_targeted_coverage': layer2++; break;
      case 'layer3_unpredictable': layer3++; break;
      case 'not_selected': notSelected++; break;
    }
  }

  const total = journals.length;
  const pct = (n: number) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));

  const driverCounts = new Map<string, number>();
  for (const j of journals) {
    for (const d of j.drivers) {
      driverCounts.set(d.ruleId, (driverCounts.get(d.ruleId) ?? 0) + 1);
    }
  }
  const sortedDrivers = [...driverCounts.entries()].sort((a, b) => b[1] - a[1]);

  const selected = journals
    .filter(j => j.selection.selected)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20);

  const lines: string[] = [];
  lines.push('# Journal Risk Selection Summary');
  lines.push('');
  lines.push(`**Run ID:** ${runResult.results.run.runId}`);
  lines.push(`**Engine Version:** ${runResult.results.run.engineVersion}`);
  lines.push(`**Run At (UTC):** ${runResult.results.run.runAtUtc}`);
  lines.push('');

  lines.push('## Population Evidence');
  lines.push('');
  lines.push(`- **Source System:** ${pop.sourceSystem}`);
  lines.push(`- **Record Count:** ${pop.recordCount.toLocaleString()}`);
  lines.push(`- **Total Debits:** ${pop.hashTotals.totalDebits.toLocaleString()}`);
  lines.push(`- **Total Credits:** ${pop.hashTotals.totalCredits.toLocaleString()}`);
  lines.push(`- **Coverage:** ${pop.coverage.fromDate} to ${pop.coverage.toDate}`);
  lines.push(`- **Includes Post-Close:** ${pop.coverage.includesPostClose ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push('## Selection Summary');
  lines.push('');
  lines.push('| Layer | Count | Percentage |');
  lines.push('|-------|------:|-----------:|');
  lines.push(`| Layer 1 - Mandatory High Risk | ${layer1} | ${pct(layer1)}% |`);
  lines.push(`| Layer 2 - Targeted Coverage | ${layer2} | ${pct(layer2)}% |`);
  lines.push(`| Layer 3 - Unpredictable | ${layer3} | ${pct(layer3)}% |`);
  lines.push(`| Not Selected | ${notSelected} | ${pct(notSelected)}% |`);
  lines.push(`| **Total** | **${total}** | **100.0%** |`);
  lines.push('');

  lines.push('## Top Risk Drivers');
  lines.push('');
  if (sortedDrivers.length === 0) {
    lines.push('No risk drivers recorded.');
  } else {
    lines.push('| Rule ID | Triggered Count |');
    lines.push('|---------|----------------:|');
    for (const [ruleId, count] of sortedDrivers) {
      lines.push(`| ${ruleId} | ${count} |`);
    }
  }
  lines.push('');

  lines.push('## Top 20 Selected Journals');
  lines.push('');
  if (selected.length === 0) {
    lines.push('No journals were selected.');
  } else {
    lines.push('| journalId | riskScore | riskBand | selectionLayer | rationale |');
    lines.push('|-----------|----------:|----------|----------------|-----------|');
    for (const j of selected) {
      lines.push(`| ${j.journalId} | ${j.riskScore} | ${j.riskBand} | ${j.selection.selectionLayer} | ${j.selection.rationale} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
