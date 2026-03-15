export const PRODUCTS = [
  {
    name: 'Financial Data Extraction',
    category: 'Statutory Audit',
    urlPrefix: 'DateExtraction',
    navLabel: 'Financial Data Extraction',
  },
  {
    name: 'Document Summary',
    category: 'Statutory Audit',
    urlPrefix: 'DocSummary',
    navLabel: 'Document Summary',
  },
  {
    name: 'Portfolio Document Extraction',
    category: 'Statutory Audit',
    urlPrefix: 'PortfolioExtraction',
    navLabel: 'Portfolio Document Extraction',
  },
  {
    name: 'Sample Calculator',
    category: 'Statutory Audit',
    urlPrefix: 'Sampling',
    navLabel: 'Sample Calculator',
  },
  {
    name: 'Financial Statements Checker',
    category: 'Statutory Audit',
    urlPrefix: 'FSChecker',
    navLabel: 'Financial Statements Checker',
  },
  {
    name: 'Agentic AI & Governance',
    category: 'Internal Audit',
    urlPrefix: 'Governance',
    navLabel: 'Agentic AI & Governance',
  },
  {
    name: 'Cybersecurity Resilience',
    category: 'Internal Audit',
    urlPrefix: 'CyberResiliance',
    navLabel: 'Cybersecurity Resilience',
  },
  {
    name: 'Workforce & Talent Risk',
    category: 'Internal Audit',
    urlPrefix: 'TalentRisk',
    navLabel: 'Workforce & Talent Risk',
  },
  {
    name: 'ESG & Sustainability Reporting',
    category: 'Internal Audit',
    urlPrefix: 'ESGSustainability',
    navLabel: 'ESG & Sustainability Reporting',
  },
  {
    name: 'Diversity Assurance',
    category: 'Internal Audit',
    urlPrefix: 'Diversity',
    navLabel: 'Diversity Assurance',
  },
];

export const STATUTORY_AUDIT_PRODUCTS = PRODUCTS.filter(
  (p) => p.category === 'Statutory Audit'
);

export const ASSURANCE_PRODUCTS = PRODUCTS.filter(
  (p) => p.category === 'Internal Audit'
);

export function getProductUrl(urlPrefix: string): string {
  return `https://${urlPrefix.toLowerCase()}.acumonintelligence.com`;
}
