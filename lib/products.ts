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
    name: 'Bank',
    category: 'Statutory Audit',
    urlPrefix: 'BankAudit',
    navLabel: 'Bank',
  },
  {
    name: 'Debtors Listing Verification',
    category: 'Statutory Audit',
    urlPrefix: 'DebtorsVerification',
    navLabel: 'Debtors Listing Verification',
  },
  {
    name: 'Creditors Listing Verification',
    category: 'Statutory Audit',
    urlPrefix: 'CreditorsVerification',
    navLabel: 'Creditors Listing Verification',
  },
  {
    name: 'Journals Testing',
    category: 'Statutory Audit',
    urlPrefix: 'JournalsTesting',
    navLabel: 'Journals Testing',
  },
  {
    name: 'FS Assertions Mapping',
    category: 'Statutory Audit',
    urlPrefix: 'FSAssertions',
    navLabel: 'FS Assertions Mapping',
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
    name: 'Meritocracy & Diversity',
    category: 'Internal Audit',
    urlPrefix: 'Diversity',
    navLabel: 'Meritocracy & Diversity',
  },
];

export const STATUTORY_AUDIT_PRODUCTS = PRODUCTS.filter(
  (p) => p.category === 'Statutory Audit'
);

export const ASSURANCE_PRODUCTS = PRODUCTS.filter(
  (p) => p.category === 'Internal Audit'
);

export const FINANCIAL_ACCOUNTS_ITEMS = [
  {
    name: 'Bank to TB',
    urlPrefix: 'BankToTB',
    navLabel: 'Bank to TB',
  },
  {
    name: 'Add JRNLS',
    urlPrefix: 'AddJrnls',
    navLabel: 'Add JRNLS',
  },
];

export const ALL_PRODUCT_CATEGORIES = [
  { category: 'Financial Accounts', products: FINANCIAL_ACCOUNTS_ITEMS },
  { category: 'Statutory Audit', products: STATUTORY_AUDIT_PRODUCTS },
  { category: 'Internal Audit', products: ASSURANCE_PRODUCTS },
];

export function getProductUrl(urlPrefix: string): string {
  return `https://${urlPrefix.toLowerCase()}.acumonintelligence.com`;
}
