/**
 * Idempotently seed the standard document templates for the current firm.
 *
 * Currently seeds:
 *   - "Planning Letter" — full HTML from the Macgregor sample with merge fields
 *     and block placeholders wired up.
 *
 * Existing templates of the same name are left alone (upsert-by-name).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const PLANNING_LETTER_HTML = `<p>Dear Sirs,</p>
<h2>Audit planning letter for the year ended {{period_end}}</h2>
<p>We are writing to communicate matters to management as required by International Standards on Auditing (UK) (ISAs (UK)) and to set out the key elements of our proposed audit approach.</p>
<p>This letter is in connection with our audit of {{client_name}} ("the company").</p>
<h3>Engagement terms and scope</h3>
<p>Our engagement letter dated {{engagement_letter_date}} sets out our terms of appointment as auditor and the agreed scope in relation to the audit of {{client_name}}. The engagement letter also set out the roles and responsibilities of us as auditors and that of those charged with governance in relation to the financial statements of the Company.</p>
<p>We are responsible for forming and expressing an opinion on the financial statements that have been prepared by management. The audit of the financial statements does not relieve management of their responsibilities detailed in the engagement letter.</p>
<h3>Audit independence and objectivity</h3>
<p>We confirm that we comply with the Ethical Standards for Auditors including FRC Ethical standard 2024 and are able to issue an objective opinion on the financial statements. We have considered our independence and objectivity in respect of audit services provided and we have identified potential threats for which we have applied appropriate safeguards as follows:</p>
{{ethics_safeguards_table}}
<p>We have not identified any other threats that impacts our independence and objectivity as auditors of the Entity.</p>
<h3>General approach</h3>
<p>Our general audit approach is determined by our assessment of the audit risk, both in terms of the potential misstatement in the financial statements and of the control environment in which the company operates.</p>
<p>To summarise our approach, we will obtain understanding of the business and its environment; review the design and implementation of key internal financial control systems; and plan and perform an audit with professional scepticism recognising that circumstances may exist that cause the financial statements to be materially misstated.</p>
<p>Significant risks will arise on most audits and are often derived from business risks that may result in a material misstatement, relate to unusual transactions that occur infrequently, or judgemental matters where measurement is uncertain. In areas where we identify the potential for significant risk, we will extend our audit testing to include more detailed substantive work. Our work in other areas will be proportionally less. The list of identified significant risks are detailed in the later part of this letter.</p>
<h3>Understanding the business and its environment</h3>
<p>We have not been advised of any significant changes in the business during the year-ended {{period_end}}.</p>
<p>{{entity_activities_description}}</p>
<h3>Fraud</h3>
<p>We have not been advised of any instances of known or suspected fraud affecting the entity involving management, employees who have a significant role in internal control or others that could have a material effect on the financial statements.</p>
<h3>Materiality</h3>
<p>We apply the concept of materiality both in planning and performing the audit, and in evaluating the effect of identified misstatements on the audit and of uncorrected misstatements. In general, misstatements, including omissions, are considered to be material if, individually or in the aggregate, they could reasonably be expected to influence the economic decisions of users taken on the basis of the financial statements.</p>
<p>Judgments about materiality are made in the light of surrounding circumstances and are affected by our perception of the financial information needs of users of the financial statements, and by the size or nature of a misstatement, or a combination of both.</p>
<p>Any identified errors greater than what is considered to be trivial will be recorded and discussed with you and, if not adjusted, confirmed as immaterial as part of your letter of representation to us.</p>
<table>
<colgroup><col width="40"><col width="60"></colgroup>
<tbody>
<tr><td><strong>Overall materiality</strong></td><td>{{materiality_overall}}</td></tr>
<tr><td><strong>How we determined it</strong></td><td>{{materiality_method}}</td></tr>
<tr><td><strong>Rationale for benchmark</strong></td><td>{{materiality_benchmark_rationale}}</td></tr>
<tr><td><strong>Performance materiality</strong></td><td>{{materiality_performance}} ({{materiality_performance_percent}} of overall materiality)</td></tr>
<tr><td><strong>Error reporting threshold</strong></td><td>{{materiality_trivial}}</td></tr>
</tbody>
</table>
<p>We will report to you misstatements above our error reporting threshold and those matters that in our opinion merited reporting on qualitative grounds. We will also report to the directors any disclosure matters that we identified when assessing the overall presentation of the financial statements.</p>
<h3>Update on prior year's management letter points</h3>
<p>The prior year accounts were audited by {{prior_auditor}}. {{prior_year_review_narrative}}</p>
<h3>Identified significant risk areas</h3>
<p>Significant risk areas identified at the planning stage of the audit and our proposed approach to each of these areas are outlined below:</p>
{{significant_risks_table}}
<h3>Areas of focus</h3>
<p>In addition to the significant risks above, we have considered the following areas as other areas of focus:</p>
{{areas_of_focus_table}}
<p>We consider {{informed_management_names}} as informed management in relation to the audit of the Company's financial statements.</p>
<h3>Engagement team</h3>
<p>Our audit team for the year-ended {{period_end}} comprises the following individuals. We have ensured that the audit team has necessary relevant experience and are competent to complete the audit of the Company's financial statements.</p>
{{engagement_team_table}}
<h3>Timetable</h3>
{{timetable_table}}
<p>Please note that these dates are provisional and conditional upon smooth flow of information and supporting documents and your timely delivery of the complete set of financial statements.</p>
<h3>Confidentiality</h3>
<p>This planning letter is strictly confidential and has been made available to the board of directors to facilitate discussions. It may not be taken as altering our responsibilities to the company arising under our audit engagement letter. The contents of this letter should not be disclosed to third parties without our prior written consent.</p>
<p>If you have any questions, please contact me. We look forward to working with you and your team.</p>
<p>Yours faithfully,</p>
<p>&nbsp;</p>
<p><strong>{{ri_name}}</strong><br>{{ri_role}}<br>{{ri_email}}</p>`;

const DEFAULT_TEMPLATES = [
  {
    name: 'Planning Letter',
    description: 'Audit planning letter sent to the board of directors / members at the start of the audit.',
    category: 'Planning',
    auditType: 'ALL',
    subject: 'Audit Planning — {{client_name}} — {{period_end}}',
    content: PLANNING_LETTER_HTML,
  },
];

export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId!;
  const results: { name: string; created: boolean }[] = [];

  for (const tpl of DEFAULT_TEMPLATES) {
    const existing = await prisma.documentTemplate.findFirst({
      where: { firmId, name: tpl.name },
    });
    if (existing) {
      results.push({ name: tpl.name, created: false });
      continue;
    }
    await prisma.documentTemplate.create({
      data: {
        firmId,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        auditType: tpl.auditType,
        subject: tpl.subject,
        content: tpl.content,
        isActive: true,
        createdBy: session.user.id || null,
      },
    });
    results.push({ name: tpl.name, created: true });
  }

  return NextResponse.json({ success: true, results });
}
