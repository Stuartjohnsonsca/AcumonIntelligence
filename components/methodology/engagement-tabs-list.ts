/**
 * Canonical engagement-tab list. Extracted to a standalone module so
 * both EngagementTabs (the renderer) AND any tab body that needs to
 * read the list (e.g. DocumentRepositoryTab's location filter) can
 * import it without forming a cycle.
 *
 * The previous arrangement had EngagementTabs export TABS while it
 * also imported every tab body — and one of those bodies imported
 * TABS back. At runtime the bundler evaluated the tab body before
 * EngagementTabs had finished initialising, leaving TABS in the
 * temporal dead zone and surfacing as
 *   "Cannot access 'cE' before initialization"
 * on the document-tab route. Keeping the list in a leaf module
 * (zero local imports) breaks that cycle for good.
 */

export const TABS = [
  { key: 'opening', label: 'Opening' },
  { key: 'prior-period', label: 'Prior Period' },
  { key: 'permanent-file', label: 'Permanent' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'continuance', label: 'Continuance' },
  { key: 'new-client', label: 'New Client Take-On' },
  { key: 'tb', label: 'TBCYvPY' },
  { key: 'materiality', label: 'Materiality' },
  { key: 'par', label: 'PAR' },
  { key: 'walkthroughs', label: 'Walkthroughs' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Documents' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'portal', label: 'Portal' },
  { key: 'communication', label: 'Communication' },
  // Tab key kept as 'tax-technical' for back-compat with existing
  // PF sections + sign-off entries; the user-facing label is
  // "Specialists" and the body renders SpecialistsTab.
  { key: 'tax-technical', label: 'Specialists' },
] as const;
