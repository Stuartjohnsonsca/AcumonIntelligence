export const CLIENT_SECTORS = [
  'Financial Services',
  'Healthcare',
  'Manufacturing',
  'Technology',
  'Public Sector',
  'Retail',
  'Energy',
  'Education',
  'Construction',
  'Legal',
  'Charities & Non-Profit',
] as const;

export type ClientSector = typeof CLIENT_SECTORS[number];
