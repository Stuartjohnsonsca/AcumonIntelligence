import fs from 'fs';
import type { RunResult } from '../types';

/**
 * Export a human-readable Markdown summary of the journal risk selection run.
 */
export function exportMarkdownSummary(
  runResult: RunResult,
  outputPath: string
): void {
  const pop = runResult.population;
  const journals = runResult.results.journals;

  // ── Selection counts ──────────────────────────────────────────────────────
  let layer1 = 0;
  let layer2 = 0;
  let layer3 = 0;
  let notSelected = 0;

  for (const j of journals) {
    switch (j.selection.selectionLayer) {
      case 'layer1_mandatory_high_risk':
        layer1++;
        break;
      case 'layer2_targeted_coverage':
        layer2++;
        break;
      case 'layer3_unpredictable':
        layer3++;
        break;
      case 'not_selected':
        notSelected++;
        break;
    }
  }

  const total = journals.length;
  const pct = (n: number) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));

  // ── Risk driver frequency ─────────────────────────────────────────────────
  const driverCounts = new Map<string, number>();
  for (const j of journals) {
    for (const d of j.drivers) {
      driverCounts.set(d.ruleId, (driverCounts.get(d.ruleId) ?? 0) + 1);
    }
  }
  const sortedDrivers = [...driverCounts.entries()].sort((a, b) => b[1] - a[1]);

  // ── Top 20 selected journals ──────────────────────────────────────────────
  const selected = journals
    .filter((j) => j.selection.selected)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20);

  // ── Build markdown ────────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push('# Journal Risk Selection Summary');
  lines.push('');
  lines.push(`**Run ID:** ${runResult.results.run.runId}`);
  lines.push(`**Engine Version:** ${runResult.results.run.engineVersion}`);
  lines.push(`**Run At (UTC):** ${runResult.results.run.runAtUtc}`);
  lines.push('');

  // Population Evidence
  lines.push('## Population Evidence');
  lines.push('');
  lines.push(`- **Source System:** ${pop.sourceSystem}`);
  lines.push(`- **Extract Run ID:** ${pop.extractRunId}`);
  lines.push(`- **Record Count:** ${pop.recordCount.toLocaleString()}`);
  lines.push(`- **Total Debits:** ${pop.hashTotals.totalDebits.toLocaleString()}`);
  lines.push(`- **Total Credits:** ${pop.hashTotals.totalCredits.toLocaleString()}`);
  lines.push(`- **Total Absolute Amounts:** ${pop.hashTotals.totalAbsoluteAmounts.toLocaleString()}`);
  lines.push(`- **Coverage:** ${pop.coverage.fromDate} to ${pop.coverage.toDate}`);
  lines.push(`- **Includes Post-Close:** ${pop.coverage.includesPostClose ? 'Yes' : 'No'}`);
  lines.push(`- **Includes Opening:** ${pop.coverage.includesOpening ? 'Yes' : 'No'}`);
  lines.push('');

  // Selection Summary
  lines.push('## Selection Summary');
  lines.push('');
  lines.push('| Layer | Count | Percentage |');
  lines.push('|-------|------:|-----------:|');
  lines.push(`| Layer 1 — Mandatory High Risk | ${layer1} | ${pct(layer1)}% |`);
  lines.push(`| Layer 2 — Targeted Coverage | ${layer2} | ${pct(layer2)}% |`);
  lines.push(`| Layer 3 — Unpredictable | ${layer3} | ${pct(layer3)}% |`);
  lines.push(`| Not Selected | ${notSelected} | ${pct(notSelected)}% |`);
  lines.push(`| **Total** | **${total}** | **100.0%** |`);
  lines.push('');

  // Top Risk Drivers
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

  // Selection Criteria
  lines.push('## Selection Criteria');
  lines.push('');
  lines.push(
    'Selection criteria included post-close/period-end journals, unusual/seldom accounts, ' +
      'senior/atypical posters, round numbers, suspicious keywords, and weak explanations.'
  );
  lines.push('');

  // Top 20 Selected Journals
  lines.push('## Top 20 Selected Journals');
  lines.push('');
  if (selected.length === 0) {
    lines.push('No journals were selected.');
  } else {
    lines.push('| journalId | riskScore | riskBand | selectionLayer | rationale |');
    lines.push('|-----------|----------:|----------|----------------|-----------|');
    for (const j of selected) {
      lines.push(
        `| ${j.journalId} | ${j.riskScore} | ${j.riskBand} | ${j.selection.selectionLayer} | ${j.selection.rationale} |`
      );
    }
  }
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
