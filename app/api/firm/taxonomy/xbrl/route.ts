import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  fetchTaxonomies,
  fetchPresentationRoots,
  fetchRelationship,
  searchConcepts,
  getFinancialStatementStructure,
  getTaxonomyIdForFramework,
  FRAMEWORK_TAXONOMY_MAP,
} from '@/lib/xbrl-taxonomy';

/**
 * GET /api/firm/taxonomy/xbrl
 * Query params:
 *   action=list-taxonomies    → List all available XBRL taxonomies
 *   action=list-frameworks    → List framework→taxonomy mappings
 *   action=fs-structure&framework=FRS102  → Get FS structure for a framework
 *   action=roots&taxonomyId=58  → Get presentation roots for a taxonomy
 *   action=children&relationshipId=123  → Get children of a relationship node
 *   action=search&taxonomyId=58&q=revenue  → Search concepts
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'list-frameworks';

  try {
    switch (action) {
      case 'list-taxonomies': {
        const taxonomies = await fetchTaxonomies();
        return NextResponse.json({ taxonomies });
      }

      case 'list-frameworks': {
        // Return framework→taxonomy mappings with metadata
        const frameworks = Object.entries(FRAMEWORK_TAXONOMY_MAP).map(([key, entries]) => ({
          code: key,
          taxonomies: entries.map(e => ({ id: e.id, name: e.name, year: e.year })),
          primaryTaxonomyId: entries[0]?.id,
        }));
        return NextResponse.json({ frameworks });
      }

      case 'fs-structure': {
        const framework = searchParams.get('framework');
        if (!framework) {
          return NextResponse.json({ error: 'framework parameter required' }, { status: 400 });
        }
        const structure = await getFinancialStatementStructure(framework);
        return NextResponse.json(structure);
      }

      case 'roots': {
        const taxonomyId = parseInt(searchParams.get('taxonomyId') || '0');
        if (!taxonomyId) {
          return NextResponse.json({ error: 'taxonomyId parameter required' }, { status: 400 });
        }
        const roots = await fetchPresentationRoots(taxonomyId);
        return NextResponse.json({ roots });
      }

      case 'children': {
        const relationshipId = parseInt(searchParams.get('relationshipId') || '0');
        if (!relationshipId) {
          return NextResponse.json({ error: 'relationshipId parameter required' }, { status: 400 });
        }
        const relationship = await fetchRelationship(relationshipId);
        // Also fetch immediate children details
        const childDetails = await Promise.all(
          relationship.children.slice(0, 50).map(async (childId) => {
            try {
              const child = await fetchRelationship(childId);
              return {
                id: child.id,
                conceptName: child.concept_name,
                conceptLabel: child.concept_label,
                hasChildren: child.children.length > 0,
                childCount: child.children.length,
              };
            } catch {
              return null;
            }
          })
        );
        return NextResponse.json({
          relationship: {
            id: relationship.id,
            conceptName: relationship.concept_name,
            conceptLabel: relationship.concept_label,
            childCount: relationship.children.length,
          },
          children: childDetails.filter(Boolean),
        });
      }

      case 'search': {
        let taxonomyId = parseInt(searchParams.get('taxonomyId') || '0');
        const framework = searchParams.get('framework');
        const query = searchParams.get('q') || '';
        // Resolve framework to taxonomyId if not provided directly
        if (!taxonomyId && framework) {
          taxonomyId = getTaxonomyIdForFramework(framework) || 0;
        }
        if (!taxonomyId || !query) {
          return NextResponse.json({ error: 'taxonomyId (or framework) and q parameters required' }, { status: 400 });
        }
        const concepts = await searchConcepts(taxonomyId, query);
        return NextResponse.json({
          concepts: concepts.slice(0, 50).map(c => ({
            id: c.id,
            name: c.name,
            label: c.label,
            type: c.type,
            abstract: c.abstract,
            periodType: c.period_type,
            balance: c.balance,
          })),
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error('XBRL taxonomy error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch taxonomy data' }, { status: 500 });
  }
}

/**
 * POST /api/firm/taxonomy/xbrl
 * Save selected taxonomy mapping for a framework to the firm.
 * Body: { framework: 'FRS102', taxonomyId: 58 }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { framework, taxonomyId } = body;
  if (!framework || !taxonomyId) {
    return NextResponse.json({ error: 'framework and taxonomyId required' }, { status: 400 });
  }

  const firmId = session.user.firmId;

  // Store framework→taxonomy mapping in methodology templates
  await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: {
        firmId,
        templateType: 'xbrl_taxonomy_mapping',
        auditType: framework,
      },
    },
    create: {
      firmId,
      templateType: 'xbrl_taxonomy_mapping',
      auditType: framework,
      items: { taxonomyId, framework } as any,
    },
    update: {
      items: { taxonomyId, framework } as any,
    },
  });

  return NextResponse.json({ success: true });
}
