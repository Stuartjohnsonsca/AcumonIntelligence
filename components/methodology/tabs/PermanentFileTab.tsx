'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { PERMANENT_FILE_SECTIONS } from '@/types/methodology';
import type { TemplateQuestion } from '@/types/methodology';

interface TeamMember {
  userId: string;
  userName?: string;
  role: string;
}

interface Props {
  engagementId: string;
  teamMembers?: TeamMember[];
}

/**
 * Default questions derived from Appendix A in Templates.xlsx.
 * These can be overridden by MethodologyTemplate data from the admin.
 */
function getDefaultQuestions(): TemplateQuestion[] {
  let sortOrder = 0;
  const q = (sectionKey: string, questionText: string, inputType: TemplateQuestion['inputType'] = 'textarea', opts?: Partial<TemplateQuestion>): TemplateQuestion => ({
    id: `pf_${sectionKey}_${sortOrder}`,
    sectionKey,
    questionText,
    inputType,
    sortOrder: sortOrder++,
    ...opts,
  });

  return [
    // Entity Details
    q('Entity Details', 'Contact'),
    q('Entity Details', 'Contact Email', 'text'),
    q('Entity Details', 'Address'),
    q('Entity Details', 'Group Companies', 'yesno'),
    q('Entity Details', 'Informed Management'),
    // Understanding the Entity
    q('Understanding the Entity', 'Ownership and governance'),
    q('Understanding the Entity', 'Principal Activity and organisation structure'),
    q('Understanding the Entity', 'Changes from prior period or significant activities that took place during the year'),
    q('Understanding the Entity', 'Key Performance Indicators'),
    q('Understanding the Entity', 'Industry'),
    q('Understanding the Entity', 'Regulatory framework (whether the entity is registered or not)?'),
    q('Understanding the Entity', 'Financing'),
    // Financial Reporting Framework
    q('Financial Reporting Framework', 'Applicable financial reporting framework'),
    q('Financial Reporting Framework', 'Significant accounting policies'),
    q('Financial Reporting Framework', 'Changes in accounting policies from prior year'),
    q('Financial Reporting Framework', 'Is Reporting currency different from functional currency', 'yesno'),
    q('Financial Reporting Framework', 'Reporting Currency', 'text'),
    // Laws and Regulations
    q('Laws and Regulations', 'What is the legal and regulatory framework applicable to the entity and the industry or sector in which it operates?'),
    q('Laws and Regulations', 'Are there any indicators of non-compliance with laws and regulations?'),
    q('Laws and Regulations', 'Are there any ongoing litigations and claims against the Company?'),
    // Related Parties
    q('Related Parties', 'List below all known related parties (as defined by accounting standards), the nature of the relationship and the likely transactions. You should include all known related parties, regardless of whether or not there are any likely transactions.'),
    q('Related Parties', 'Assess the risk of material misstatement associated with related parties and determine whether these amount to significant risks.'),
    q('Related Parties', 'Are there any related relationships not identified by management?'),
    q('Related Parties', 'Directors - Name & Nature / Type and purpose of likely transactions'),
    q('Related Parties', 'Group entities (parent & affiliates) - Name & Nature / Type and purpose'),
    q('Related Parties', 'Other affiliates - Name & Nature / Type and purpose'),
    // IT Environment
    q('IT Environment', 'IT systems used by client'),
    q('IT Environment', 'Are these cloud based systems?'),
    q('IT Environment', 'Are these any customisation to the accounts software?'),
    q('IT Environment', 'List of members who has access to the system?'),
    q('IT Environment', 'Final conclusion on the complexity of the IT system', 'dropdown', { dropdownOptions: ['Complex', 'Not Complex'] }),
    q('IT Environment', 'Provides list of reports where IPE procedures will be performed to test completeness and accuracy of the report.'),
    // Accounting Estimates
    q('Accounting Estimates', 'List of accounting estimates relevant to the entity'),
    q('Accounting Estimates', 'Assess complexity of each accounting estimate considering the subjectivity and uncertainty involved'),
    q('Accounting Estimates', 'Explain control procedures in place relating to accounting estimates and how those charged with governance oversee the estimation process.'),
    // Fraud Risk Analysis
    q('Fraud Risk Analysis', 'Conclusion on the fraud risk assessment'),
    q('Fraud Risk Analysis', 'Confirm that fraud triangle covering incentive/pressures, opportunities and attitudes/rationalisation is considered as part of fraud risk assessment?'),
    // Auditor\'s Expert
    q("Auditor's Expert", 'Did the audit team identify the need to involve audit experts / specialists in addressing the significant risk?'),
    q("Auditor's Expert", 'Explain in detail how audit team has assessed the competence and capabilities of Auditor Expert involved in the engagement'),
    q("Auditor's Expert", 'Has the audit team issued instructions to expert/specialist setting the scope of work?'),
    q("Auditor's Expert", 'Did audit team obtain confirmation with regard to compliance with FRC Ethical Standard 2024 of both Auditor Expert?'),
    // Management Expert
    q('Management Expert', 'With respect to the identified significant risk, did use management expert?'),
    q('Management Expert', 'Did the audit team obtain a copy of the engagement letter signed by the entity with management expert?'),
    q('Management Expert', 'Has the audit team issued instructions to expert/specialist setting the scope of work?'),
    // Service Organisation
    q('Service Organisation', 'Provide list of service organisations and the nature and significance of the services provided'),
    q('Service Organisation', 'Did the audit team obtain a copy of the engagement letter signed by the entity with the service organisation?'),
    q('Service Organisation', 'Document your understanding of: Effect on user entity\'s internal control, Nature and materiality of transactions processed, Degree of interaction between activities of SO and entity, etc.'),
    q('Service Organisation', 'Document your understanding of the control framework at the service organisation including those applied to the transactions processed.'),
  ];
}

export function PermanentFileTab({ engagementId, teamMembers = [] }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/permanent-file`);
      if (res.ok) {
        const json = await res.json();
        // Flatten section data into single values object
        const flat: Record<string, unknown> = {};
        for (const [, sectionData] of Object.entries(json.data || {})) {
          if (typeof sectionData === 'object' && sectionData) {
            Object.assign(flat, sectionData);
          }
        }
        setData(flat);
      }
    } catch (err) {
      console.error('Failed to load permanent file:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Client Permanent File...</div>;
  }

  const questions = getDefaultQuestions();

  return (
    <DynamicAppendixForm
      engagementId={engagementId}
      endpoint="permanent-file"
      questions={questions}
      initialData={data as Record<string, string | number | boolean | null>}
      title="Client Permanent File"
      teamMembers={teamMembers}
    />
  );
}
