import { prisma } from '@/lib/db';

/**
 * Trigger Engine
 *
 * When a trigger event occurs (e.g. "On Start", "On Section Sign Off"),
 * this engine checks Questionnaire Actions mappings and creates individual
 * portal request items for each matched question.
 *
 * Flow:
 * 1. Look up questionnaire_actions mappings for the trigger + auditType
 * 2. Find the corresponding questionnaire questions
 * 3. Create portal_request records for the client to respond to
 */

interface TriggerContext {
  triggerName: string;      // e.g. "On Start", "On Section Sign Off"
  engagementId: string;
  clientId: string;
  auditType: string;
  firmId: string;
  userId: string;           // firm user who triggered
  sectionName?: string;     // for "On Section Sign Off" — which section
}

/**
 * Fire a trigger and create portal requests for matched questionnaire questions.
 * Returns the number of portal requests created.
 */
export async function fireTrigger(ctx: TriggerContext): Promise<number> {
  try {
    // 1. Load questionnaire action mappings
    const mapRecord = await prisma.methodologyTemplate.findFirst({
      where: { firmId: ctx.firmId, templateType: 'questionnaire_actions' },
    });

    if (!mapRecord) return 0;

    const mappings = typeof mapRecord.items === 'object' && mapRecord.items !== null
      ? mapRecord.items as Record<string, Record<string, string>>
      : {};

    // 2. Find question IDs that match this trigger + audit type
    const matchedQuestionIds: string[] = [];
    for (const [questionId, auditTypeMap] of Object.entries(mappings)) {
      const trigger = auditTypeMap[ctx.auditType] || auditTypeMap['ALL'];
      if (trigger === ctx.triggerName) {
        matchedQuestionIds.push(questionId);
      }
    }

    if (matchedQuestionIds.length === 0) return 0;

    // 3. Load questionnaires to get question text
    const questionnaires = await prisma.methodologyTemplate.findMany({
      where: { firmId: ctx.firmId, templateType: 'questionnaire' },
    });

    const questionMap = new Map<string, { text: string; groupTitle: string; questionnaireName: string }>();
    for (const qRecord of questionnaires) {
      const items = typeof qRecord.items === 'object' && qRecord.items !== null
        ? qRecord.items as Record<string, unknown>
        : {};
      const name = (items.name as string) || 'Questionnaire';
      const groups = (items.groups as any[]) || [];
      for (const group of groups) {
        for (const q of (group.questions || [])) {
          questionMap.set(q.id, {
            text: q.text || 'Question',
            groupTitle: group.title || 'General',
            questionnaireName: name,
          });
        }
      }
    }

    // 4. Check existing portal requests to avoid duplicates
    let existingPortalRequests: { question: string }[] = [];
    try {
      existingPortalRequests = await prisma.portalRequest.findMany({
        where: {
          clientId: ctx.clientId,
          engagementId: ctx.engagementId,
          status: 'outstanding',
        },
        select: { question: true },
      });
    } catch {
      // portalRequest table may not exist yet
    }
    const existingQuestions = new Set(existingPortalRequests.map(r => r.question));

    // 6. Get the firm user's name for requestedByName
    let userName = 'System';
    try {
      const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
      if (user?.name) userName = user.name;
    } catch {}

    // 7. Create portal requests for each matched question
    let created = 0;
    for (const questionId of matchedQuestionIds) {
      const question = questionMap.get(questionId);
      if (!question) continue;

      const questionText = `[${question.questionnaireName} / ${question.groupTitle}] ${question.text}`;
      if (existingQuestions.has(questionText)) continue; // skip duplicates

      try {
        await prisma.portalRequest.create({
          data: {
            clientId: ctx.clientId,
            engagementId: ctx.engagementId,
            section: 'questions',
            question: questionText,
            status: 'outstanding',
            requestedById: ctx.userId,
            requestedByName: userName,
          },
        });
        created++;
      } catch (err) {
        console.error('[TriggerEngine] Failed to create portal request:', err);
      }
    }

    return created;
  } catch (err) {
    console.error('[TriggerEngine] Error firing trigger:', ctx.triggerName, err);
    return 0;
  }
}
