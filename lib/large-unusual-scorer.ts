/**
 * Large & Unusual Transaction Scorer
 * Extracted to separate file to avoid Vercel/SWC minification issues.
 */

interface ScoringRules {
  descriptionPatterns: { pattern: string; category: string; weight: number }[];
  sizeScoring: { extreme3Sigma: number; outlier2Sigma: number; aboveAvg1Sigma: number; abovePM: number; aboveCT: number };
  timingScoring: { weekend: number; bankHoliday: number };
  otherScoring: { roundThousands: number; roundHundreds: number; oneOff: number; infrequent: number; contraEntry: number };
  thresholds: { mediumRisk: number; financialPctPM: number };
}

const DEFAULT_RULES: ScoringRules = {
  descriptionPatterns: [
    { pattern: 'director|shareholder|owner', category: 'Related party', weight: 30 },
    { pattern: 'loan|advance|lend', category: 'Loan/advance', weight: 25 },
    { pattern: 'intercompany|group|subsidiary|parent', category: 'Intercompany', weight: 25 },
    { pattern: 'related party', category: 'Related party', weight: 30 },
    { pattern: 'refund|reversal|correction|adjust', category: 'Reversal/correction', weight: 15 },
    { pattern: 'dividend|distribution', category: 'Distribution', weight: 20 },
    { pattern: 'settlement|legal|solicitor|court', category: 'Legal/settlement', weight: 25 },
    { pattern: 'penalty|fine|hmrc|tax', category: 'Tax/penalty', weight: 15 },
    { pattern: 'cash|atm|withdraw', category: 'Cash withdrawal', weight: 20 },
    { pattern: 'foreign|fx|transfer overseas|swift', category: 'Foreign/FX', weight: 15 },
    { pattern: 'consultancy|management fee|advisory', category: 'Consultancy', weight: 15 },
    { pattern: 'donation|charity|gift', category: 'Donation/gift', weight: 20 },
    { pattern: 'insurance|claim', category: 'Insurance/claim', weight: 10 },
    { pattern: 'property|rent deposit|lease premium', category: 'Property/deposit', weight: 15 },
  ],
  sizeScoring: { extreme3Sigma: 40, outlier2Sigma: 25, aboveAvg1Sigma: 10, abovePM: 20, aboveCT: 5 },
  timingScoring: { weekend: 15, bankHoliday: 20 },
  otherScoring: { roundThousands: 10, roundHundreds: 5, oneOff: 10, infrequent: 5, contraEntry: 10 },
  thresholds: { mediumRisk: 15, financialPctPM: 5 },
};

const BANK_HOLIDAYS = new Set([
  '2024-01-01','2024-03-29','2024-04-01','2024-05-06','2024-05-27','2024-08-26','2024-12-25','2024-12-26',
  '2025-01-01','2025-04-18','2025-04-21','2025-05-05','2025-05-26','2025-08-25','2025-12-25','2025-12-26',
]);

function getAmount(txn: Record<string, any>): number {
  var a = Math.abs(Number(txn['debit'] || txn['debitFC'] || txn['amount'] || 0));
  var b = Math.abs(Number(txn['credit'] || txn['creditFC'] || 0));
  return a > b ? a : b;
}

function copyTxn(txn: Record<string, any>): Record<string, any> {
  var result: Record<string, any> = {};
  var keys = Object.keys(txn);
  for (var i = 0; i < keys.length; i++) {
    result[keys[i]] = txn[keys[i]];
  }
  return result;
}

export function scoreTransactions(
  allTxns: Record<string, any>[],
  pm: number,
  ct: number,
  rulesInput?: Partial<ScoringRules>,
): { scored: Record<string, any>[]; summary: string; flaggedCount: number; decisionLog: { step: string; result: string }[] } {
  var rules = { ...DEFAULT_RULES, ...rulesInput } as ScoringRules;
  if (rulesInput?.descriptionPatterns && rulesInput.descriptionPatterns.length > 0) {
    rules.descriptionPatterns = rulesInput.descriptionPatterns;
  }
  var sizeW = rules.sizeScoring;
  var timingW = rules.timingScoring;
  var otherW = rules.otherScoring;
  var threshold = rules.thresholds.mediumRisk;
  var financialPctPM = rules.thresholds.financialPctPM || 5;
  var financialThreshold = pm > 0 ? pm * financialPctPM / 100 : 0;

  // Compile regex patterns
  var compiledPatterns: { regex: RegExp; category: string; weight: number }[] = [];
  for (var pi = 0; pi < rules.descriptionPatterns.length; pi++) {
    try {
      compiledPatterns.push({
        regex: new RegExp(rules.descriptionPatterns[pi].pattern, 'i'),
        category: rules.descriptionPatterns[pi].category,
        weight: rules.descriptionPatterns[pi].weight,
      });
    } catch (e) {
      // Invalid regex — skip
    }
  }

  // Statistics
  var totalAmt = 0;
  var amtCount = 0;
  for (var i = 0; i < allTxns.length; i++) {
    var a = getAmount(allTxns[i]);
    if (a > 0) { totalAmt += a; amtCount++; }
  }
  var meanAmt = amtCount > 0 ? totalAmt / amtCount : 0;
  var variance = 0;
  for (var i = 0; i < allTxns.length; i++) {
    var a = getAmount(allTxns[i]);
    if (a > 0) variance += (a - meanAmt) * (a - meanAmt);
  }
  var stdDev = amtCount > 0 ? Math.sqrt(variance / amtCount) : 0;

  // Frequency map
  var descFreq: Record<string, number> = {};
  for (var i = 0; i < allTxns.length; i++) {
    var key = String(allTxns[i]['description'] || '').toLowerCase().trim().slice(0, 50);
    descFreq[key] = (descFreq[key] || 0) + 1;
  }

  // Majority direction
  var debitCount = 0;
  for (var i = 0; i < allTxns.length; i++) {
    if (Math.abs(Number(allTxns[i]['debit'] || allTxns[i]['debitFC'] || 0)) > Math.abs(Number(allTxns[i]['credit'] || allTxns[i]['creditFC'] || 0))) debitCount++;
  }
  var majorityIsDebit = debitCount > allTxns.length / 2;

  // Score
  var scored: Record<string, any>[] = [];
  var belowCount = 0;
  var flaggedCount = 0;

  for (var idx = 0; idx < allTxns.length; idx++) {
    var txn = allTxns[idx];
    var row = copyTxn(txn);
    row['_index'] = idx;

    try {
      var amt = getAmount(txn);

      if (financialThreshold > 0 && amt < financialThreshold) {
        row['_score'] = 0;
        row['_reasons'] = [];
        row['_flagged'] = false;
        row['_belowThreshold'] = true;
        belowCount++;
        scored.push(row);
        continue;
      }

      var score = 0;
      var reasons: string[] = [];

      // Size
      if (amt > 0 && stdDev > 0) {
        var zScore = (amt - meanAmt) / stdDev;
        if (zScore > 3) { score += sizeW.extreme3Sigma; reasons.push('Extreme outlier (' + zScore.toFixed(1) + '\u03C3)'); }
        else if (zScore > 2) { score += sizeW.outlier2Sigma; reasons.push('Statistical outlier (' + zScore.toFixed(1) + '\u03C3)'); }
        else if (zScore > 1) { score += sizeW.aboveAvg1Sigma; reasons.push('Above average (' + zScore.toFixed(1) + '\u03C3)'); }
      }
      if (amt > pm && pm > 0) { score += sizeW.abovePM; reasons.push('Above PM'); }
      else if (amt > ct && ct > 0) { score += sizeW.aboveCT; reasons.push('Above CT'); }

      // Round
      if (amt >= 1000 && amt % 1000 === 0) { score += otherW.roundThousands; reasons.push('Round number'); }
      if (amt >= 100 && amt % 100 === 0 && amt % 1000 !== 0) { score += otherW.roundHundreds; reasons.push('Round hundreds'); }

      // Timing
      if (txn['date']) {
        try {
          var dateObj = new Date(String(txn['date']));
          if (!isNaN(dateObj.getTime())) {
            var dow = dateObj.getDay();
            if (dow === 0 || dow === 6) { score += timingW.weekend; reasons.push('Weekend'); }
            var isoStr = dateObj.toISOString().split('T')[0];
            if (BANK_HOLIDAYS.has(isoStr)) { score += timingW.bankHoliday; reasons.push('Bank holiday'); }
          }
        } catch (de) { /* skip */ }
      }

      // Patterns
      var descText = String(txn['description'] || '');
      for (var pj = 0; pj < compiledPatterns.length; pj++) {
        if (compiledPatterns[pj].regex.test(descText)) {
          score += compiledPatterns[pj].weight;
          reasons.push(compiledPatterns[pj].category);
        }
      }

      // Rarity
      var descLow = descText.toLowerCase().trim().slice(0, 50);
      var freq = descFreq[descLow] || 1;
      if (freq === 1) { score += otherW.oneOff; reasons.push('One-off'); }
      else if (freq <= 3) { score += otherW.infrequent; reasons.push('Infrequent (' + freq + ')'); }

      // Contra
      if (amt > ct) {
        var isDebit = Math.abs(Number(txn['debit'] || txn['debitFC'] || 0)) > Math.abs(Number(txn['credit'] || txn['creditFC'] || 0));
        if (isDebit !== majorityIsDebit) { score += otherW.contraEntry; reasons.push('Contra entry'); }
      }

      row['_score'] = score;
      row['_reasons'] = reasons;
      row['_flagged'] = score >= threshold;
      if (score >= threshold) flaggedCount++;

    } catch (err) {
      row['_score'] = 0;
      row['_reasons'] = ['Error: ' + String(err)];
      row['_flagged'] = false;
    }

    scored.push(row);
  }

  // Sort by score descending
  scored.sort(function(a, b) { return (b['_score'] || 0) - (a['_score'] || 0); });

  var summary = 'Scored ' + allTxns.length + ' transactions. ' +
    (belowCount > 0 ? belowCount + ' below financial threshold. ' : '') +
    flaggedCount + ' flagged (score >= ' + threshold + '). ' +
    'Mean: \u00A3' + meanAmt.toFixed(2) + ', StdDev: \u00A3' + stdDev.toFixed(2) + '. ' +
    'PM: \u00A3' + pm.toFixed(2) + ', CT: \u00A3' + ct.toFixed(2) + '.';

  var decisionLog = [
    { step: 'Financial threshold', result: financialThreshold > 0 ? '\u00A3' + financialThreshold.toFixed(0) + ' (' + financialPctPM + '% of PM). ' + belowCount + ' filtered.' : 'None.' },
    { step: 'Statistics', result: allTxns.length + ' txns, mean \u00A3' + meanAmt.toFixed(2) + ', stddev \u00A3' + stdDev.toFixed(2) },
    { step: 'Scoring', result: compiledPatterns.length + ' patterns, size/timing/rarity/contra checks' },
    { step: 'Results', result: flaggedCount + ' items above threshold (' + threshold + ')' },
  ];

  return { scored: scored, summary: summary, flaggedCount: flaggedCount, decisionLog: decisionLog };
}
