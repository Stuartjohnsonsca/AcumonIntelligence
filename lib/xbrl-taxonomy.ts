/**
 * XBRL Taxonomy API client.
 * Connects to Thermuthis Digital's XBRL API to fetch taxonomy data
 * for different accounting frameworks (IFRS, FRS102, FRS101, etc.)
 */

const BASE_URL = process.env.XBRL_TAXONOMY_API_URL || 'https://api.thermuthisdigital.com/api/xbrl';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Taxonomy {
  id: number;
  name: string;
  namespace: string;
  entrypoint: string;
}

export interface RelationshipRoot {
  id: number;
  reltype: 'PRE' | 'DIM';
  taxonomy: number;
  name: string;
  definition: string;
  role: string;
  children: number[];
}

export interface Relationship {
  id: number;
  reltype: 'PRE' | 'DIM';
  taxonomy: number;
  concept: number;
  concept_name: string;
  concept_label: string;
  parent: number | null;
  children: number[];
  order: number;
  arcrole?: string;
}

export interface Concept {
  id: number;
  taxonomy: number;
  name: string;
  label: string;
  type: string;
  abstract: boolean;
  nillable: boolean;
  period_type: string;
  balance?: string;
  substitution_group?: string;
}

export interface Hypercube {
  id: number;
  concept_name: string;
  concept_label: string;
  dimensions: Array<{
    id: number;
    concept_name: string;
    concept_label: string;
  }>;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ─── Framework to Taxonomy mapping ──────────────────────────────────────────

// Map accounting frameworks to their taxonomy IDs (preferring 2025 versions)
export const FRAMEWORK_TAXONOMY_MAP: Record<string, { id: number; name: string; year: string }[]> = {
  'IFRS': [
    { id: 55, name: 'IFRS', year: '2025' },
    { id: 59, name: 'IFRS-UKSEF', year: '2025' },
    { id: 7, name: 'IFRS', year: '2024' },
  ],
  'FRS102': [
    { id: 54, name: 'FRS-102', year: '2025' },
    { id: 58, name: 'FRS-102-UKSEF', year: '2025' },
    { id: 6, name: 'FRS-102', year: '2024' },
  ],
  'FRS101': [
    { id: 53, name: 'FRS-101', year: '2025' },
    { id: 5, name: 'FRS-101', year: '2024' },
  ],
  'Charities': [
    { id: 61, name: 'Charities', year: '2025' },
  ],
};

/**
 * Get the primary taxonomy ID for an accounting framework.
 */
export function getTaxonomyIdForFramework(framework: string): number | null {
  const entries = FRAMEWORK_TAXONOMY_MAP[framework];
  return entries?.[0]?.id || null;
}

// ─── API Functions ──────────────────────────────────────────────────────────

async function fetchApi<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 86400 }, // Cache for 24 hours
  });
  if (!res.ok) {
    throw new Error(`XBRL API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Fetch all available taxonomies.
 */
export async function fetchTaxonomies(): Promise<Taxonomy[]> {
  const data = await fetchApi<PaginatedResponse<Taxonomy>>('/taxonomies/');
  return data.results;
}

/**
 * Fetch presentation tree roots for a taxonomy.
 */
export async function fetchPresentationRoots(taxonomyId: number): Promise<RelationshipRoot[]> {
  const data = await fetchApi<PaginatedResponse<RelationshipRoot>>(
    `/relationshiproots/?taxonomy=${taxonomyId}&reltype=PRE`
  );
  return data.results;
}

/**
 * Fetch dimension tree roots for a taxonomy.
 */
export async function fetchDimensionRoots(taxonomyId: number): Promise<RelationshipRoot[]> {
  const data = await fetchApi<PaginatedResponse<RelationshipRoot>>(
    `/relationshiproots/?taxonomy=${taxonomyId}&reltype=DIM`
  );
  return data.results;
}

/**
 * Fetch a relationship node and its children.
 */
export async function fetchRelationship(relationshipId: number): Promise<Relationship> {
  return fetchApi<Relationship>(`/relationships/${relationshipId}/`);
}

/**
 * Search relationships within a taxonomy.
 */
export async function searchRelationships(taxonomyId: number, search: string, reltype?: 'PRE' | 'DIM'): Promise<Relationship[]> {
  let url = `/relationships/?taxonomy=${taxonomyId}&search=${encodeURIComponent(search)}`;
  if (reltype) url += `&reltype=${reltype}`;
  const data = await fetchApi<PaginatedResponse<Relationship>>(url);
  return data.results;
}

/**
 * Fetch a concept by ID.
 */
export async function fetchConcept(conceptId: number): Promise<Concept> {
  return fetchApi<Concept>(`/concepts/${conceptId}/`);
}

/**
 * Search concepts within a taxonomy.
 */
export async function searchConcepts(taxonomyId: number, search: string): Promise<Concept[]> {
  const data = await fetchApi<PaginatedResponse<Concept>>(
    `/concepts/?taxonomy=${taxonomyId}&search=${encodeURIComponent(search)}`
  );
  return data.results;
}

/**
 * Look up a concept by exact name.
 */
export async function fetchConceptByName(taxonomyId: number, name: string): Promise<Concept | null> {
  const data = await fetchApi<PaginatedResponse<Concept>>(
    `/concepts/?taxonomy=${taxonomyId}&name=${encodeURIComponent(name)}`
  );
  return data.results[0] || null;
}

/**
 * Fetch dimensions (hypercubes) for a specific concept.
 */
export async function fetchHypercubes(conceptId: number): Promise<Relationship[]> {
  const data = await fetchApi<PaginatedResponse<Relationship>>(
    `/hypercubes/?forconcept=${conceptId}`
  );
  return data.results;
}

// ─── High-level convenience functions ───────────────────────────────────────

/**
 * Get the financial statement structure for a framework.
 * Returns the presentation tree roots that represent FS sections
 * (P&L, Balance Sheet, Cash Flow, Notes, etc.)
 */
export async function getFinancialStatementStructure(framework: string): Promise<{
  taxonomyId: number;
  taxonomyName: string;
  sections: Array<{ id: number; name: string; definition: string; childCount: number }>;
}> {
  const taxonomyId = getTaxonomyIdForFramework(framework);
  if (!taxonomyId) throw new Error(`No taxonomy found for framework: ${framework}`);

  const roots = await fetchPresentationRoots(taxonomyId);
  const taxonomies = await fetchTaxonomies();
  const taxonomy = taxonomies.find(t => t.id === taxonomyId);

  // Filter to financial statement sections (skip metadata sections)
  const fsSections = roots.filter(r => {
    const def = r.definition.toLowerCase();
    return def.includes('statement') || def.includes('balance') || def.includes('income') ||
           def.includes('profit') || def.includes('cash') || def.includes('equity') ||
           def.includes('note') || def.includes('disclosure') || def.includes('audit') ||
           def.includes('director') || !def.startsWith('00');
  });

  return {
    taxonomyId,
    taxonomyName: taxonomy?.name || framework,
    sections: fsSections.map(r => ({
      id: r.id,
      name: r.name,
      definition: r.definition,
      childCount: r.children.length,
    })),
  };
}

/**
 * Get the concept tree for a specific presentation root.
 * Recursively fetches children up to a specified depth.
 */
export async function getConceptTree(
  rootChildId: number,
  maxDepth: number = 3
): Promise<{
  id: number;
  name: string;
  label: string;
  isAbstract: boolean;
  children: any[];
}> {
  const rel = await fetchRelationship(rootChildId);
  const concept = await fetchConcept(rel.concept);

  const children = maxDepth > 0
    ? await Promise.all(rel.children.map(childId => getConceptTree(childId, maxDepth - 1)))
    : [];

  return {
    id: rel.id,
    name: concept.name,
    label: concept.label || rel.concept_label || concept.name,
    isAbstract: concept.abstract,
    children,
  };
}

/**
 * Get a flat list of non-abstract concepts (leaf nodes) from a presentation root.
 * These are the actual line items that can appear in financial statements.
 */
export async function getLineItems(
  taxonomyId: number,
  rootId: number,
  maxDepth: number = 5
): Promise<Array<{ conceptId: number; name: string; label: string; depth: number }>> {
  const root = await fetchApi<RelationshipRoot>(`/relationshiproots/${rootId}/`);
  const items: Array<{ conceptId: number; name: string; label: string; depth: number }> = [];

  async function walk(childIds: number[], depth: number) {
    if (depth > maxDepth) return;
    for (const childId of childIds) {
      const rel = await fetchRelationship(childId);
      if (rel.concept_label && !rel.concept_name?.includes('Abstract')) {
        items.push({
          conceptId: rel.concept,
          name: rel.concept_name || '',
          label: rel.concept_label || rel.concept_name || '',
          depth,
        });
      }
      if (rel.children.length > 0) {
        await walk(rel.children, depth + 1);
      }
    }
  }

  await walk(root.children, 0);
  return items;
}
