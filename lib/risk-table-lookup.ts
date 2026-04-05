/**
 * Risk table lookup utilities for RMM tab.
 * Uses Appendix F (Inherent Risk) and Appendix G (Control Risk) matrices.
 */

import type { InherentRiskTable, ControlRiskTable, RiskLevel, Likelihood, Magnitude, ControlRiskLevel } from '@/types/methodology';

// Default Inherent Risk Table (Appendix F) - Likelihood × Magnitude → RiskLevel
const DEFAULT_INHERENT_RISK: InherentRiskTable = {
  matrix: {
    'Remote':      { 'Remote': 'Remote', 'Low': 'Remote', 'Medium': 'Low',    'High': 'Low',    'Very High': 'Low' },
    'Unlikely':    { 'Remote': 'Remote', 'Low': 'Low',    'Medium': 'Low',    'High': 'Medium', 'Very High': 'High' },
    'Neutral':     { 'Remote': 'Low',    'Low': 'Low',    'Medium': 'Medium', 'High': 'High',   'Very High': 'High' },
    'Likely':      { 'Remote': 'Low',    'Low': 'Medium', 'Medium': 'High',   'High': 'Very High', 'Very High': 'Very High' },
    'Very Likely': { 'Remote': 'Low',    'Low': 'High',   'Medium': 'High',   'High': 'Very High', 'Very High': 'Very High' },
  },
};

// Default Control Risk Table (Appendix G) - InherentRisk × ControlRisk → RiskLevel
const DEFAULT_CONTROL_RISK: ControlRiskTable = {
  matrix: {
    'Remote':    { 'Not Tested': 'Remote', 'Effective': 'Remote', 'Not Effective': 'Low',    'Partially Effective': 'Low' },
    'Low':       { 'Not Tested': 'Low',    'Effective': 'Low',    'Not Effective': 'Low',    'Partially Effective': 'Medium' },
    'Medium':    { 'Not Tested': 'Medium', 'Effective': 'Low',    'Not Effective': 'Medium', 'Partially Effective': 'High' },
    'High':      { 'Not Tested': 'High',   'Effective': 'Medium', 'Not Effective': 'High',   'Partially Effective': 'High' },
    'Very High': { 'Not Tested': 'High',   'Effective': 'High',   'Not Effective': 'High',   'Partially Effective': 'Very High' },
  },
};

export function lookupInherentRisk(
  likelihood: Likelihood | string | null,
  magnitude: Magnitude | string | null,
  customTable?: InherentRiskTable | null
): RiskLevel | null {
  if (!likelihood || !magnitude) return null;
  const table = customTable || DEFAULT_INHERENT_RISK;
  const row = table.matrix[likelihood as Likelihood];
  if (!row) return null;
  return row[magnitude as Magnitude] || null;
}

export function lookupOverallRisk(
  inherentRisk: RiskLevel | string | null,
  controlRisk: ControlRiskLevel | string | null,
  customTable?: ControlRiskTable | null
): RiskLevel | null {
  if (!inherentRisk || !controlRisk) return null;
  const table = customTable || DEFAULT_CONTROL_RISK;
  const row = table.matrix[inherentRisk as RiskLevel];
  if (!row) return null;
  return row[controlRisk as ControlRiskLevel] || null;
}

// Risk Classification — maps Overall Risk → test allocation category
export type RiskClassification = 'Significant Risk' | 'Area of Focus' | 'AR';

export interface RiskClassificationTable {
  matrix: Record<string, RiskClassification>;
}

// Default: High/Very High = Significant Risk, Medium = Area of Focus, everything else = AR
const DEFAULT_RISK_CLASSIFICATION: RiskClassificationTable = {
  matrix: {
    'Remote': 'AR',
    'Low': 'AR',
    'Medium': 'Area of Focus',
    'High': 'Significant Risk',
    'Very High': 'Significant Risk',
  },
};

export function lookupRiskClassification(
  overallRisk: RiskLevel | string | null,
  customTable?: RiskClassificationTable | null
): RiskClassification | null {
  if (!overallRisk) return null;
  const table = customTable || DEFAULT_RISK_CLASSIFICATION;
  return table.matrix[overallRisk] || null;
}

/** Get CSS background color class for a risk level */
export function riskColor(level: string | null | undefined): string {
  switch (level) {
    case 'Remote': return 'bg-gray-100 text-gray-600';
    case 'Low': return 'bg-green-100 text-green-700';
    case 'Medium': return 'bg-yellow-100 text-yellow-700';
    case 'High': return 'bg-orange-100 text-orange-700';
    case 'Very High': return 'bg-red-100 text-red-700';
    default: return 'bg-white text-slate-500';
  }
}

/** Get a graduated background for inherent risk sub-component dropdowns */
export function inherentRiskDropdownColor(level: string | null | undefined): string {
  switch (level) {
    case 'Remote': return 'bg-gray-50';
    case 'Low': return 'bg-green-50';
    case 'Medium': return 'bg-yellow-50';
    case 'High': return 'bg-orange-50';
    case 'Very High': return 'bg-red-50';
    default: return 'bg-white';
  }
}
