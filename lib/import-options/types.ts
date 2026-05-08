// Shared types for the Import Options pop-up shown when an engagement
// is first opened, the cloud-audit-connector registry, and the AI
// extraction proposal scratchpad. UI + API both import from here.

export type ImportSelection = 'import_data' | 'copy_documents' | 'ai_populate_current';

/** Three "big tile" options shown both inline on the audit setup card
 *  and inside the Import Options modal. Single source of truth so
 *  copy doesn't drift between the two surfaces. */
export const IMPORT_SELECTION_OPTIONS: { key: ImportSelection; label: string; description: string }[] = [
  {
    key: 'import_data',
    label: 'Import data from another audit file',
    description: 'Pull questionnaire answers, materiality, plan and similar from a prior period or another vendor.',
  },
  {
    key: 'copy_documents',
    label: 'Copy documents from another audit file',
    description: 'Bring across the prior period’s evidence files so they’re available on the matching tabs.',
  },
  {
    key: 'ai_populate_current',
    label: 'Use AI to populate current year',
    description: 'Let Claude draft initial answers across the file based on the source you provide.',
  },
];

export type ImportSourceType = 'upload' | 'cloud' | 'cloud_other' | 'claude_cowork';

export interface ImportSource {
  type: ImportSourceType;
  /** When type='upload' | 'claude_cowork': AuditDocument.id of the resulting archive. */
  sourceFileDocumentId?: string;
  /** When type='cloud': CloudAuditConnector.id used to fetch. */
  connectorId?: string;
  /** Display label saved to history (e.g. file name or vendor + client). */
  vendorLabel?: string;
}

export interface ImportOptionsState {
  prompted: boolean;
  selections: ImportSelection[];
  source?: ImportSource;
  byUserId?: string;
  byUserName?: string | null;
  at?: string; // ISO timestamp
  status: 'pending' | 'extracted' | 'applied' | 'cancelled';
  extractionId?: string;
  history?: ImportHistoryEntry[];
}

export interface ImportHistoryEntry {
  event: 'prompted' | 'cancelled' | 'uploaded' | 'cloud_fetched' | 'extracted' | 'applied' | 'documents_copied' | 'current_year_populated';
  at: string;
  by?: { userId: string; userName: string | null };
  note?: string;
}

// ─── Cloud connector recipe ─────────────────────────────────────────

export type CloudAuthScheme = 'bearer' | 'basic' | 'api_key' | 'oauth2_client_credentials';

export interface CloudConnectorEndpoint {
  method: 'GET' | 'POST';
  /** Path relative to baseUrl. Supports {clientName} {periodEnd} {engagementId} substitution. */
  path: string;
  /** Optional dotted path into the JSON response that contains the data we want. */
  jsonPath?: string;
  /** Optional headers to merge in for this endpoint. */
  headers?: Record<string, string>;
}

export interface CloudConnectorConfig {
  baseUrl: string;
  authScheme: CloudAuthScheme;
  /** Where the credential goes when authScheme = 'api_key' or 'bearer'. */
  authConfig?: {
    headerName?: string;
    /** OAuth 2.0 client credentials grant config. */
    oauth2?: { tokenUrl: string; scope?: string };
  };
  endpoints: {
    listClients?: CloudConnectorEndpoint;
    listPeriods?: CloudConnectorEndpoint;
    fetchEngagement?: CloudConnectorEndpoint;
    downloadArchive?: CloudConnectorEndpoint;
  };
  /** Optional vendor-specific notes shown to the user during connection. */
  notes?: string;
}

export interface CloudConnectorRecord {
  id: string;
  firmId: string;
  vendorKey: string;
  label: string;
  config: CloudConnectorConfig;
  isBuiltIn: boolean;
  isActive: boolean;
}

// ─── Extraction proposal ────────────────────────────────────────────

export type ProposalDestinationKind = 'json_blob' | 'row_table';

export interface ProposalDestination {
  kind: ProposalDestinationKind;
  /** Tab key — must NOT be 'rmm' or 'tb' for current-year AI population. */
  tabKey: string;
  /** For json_blob destinations: the section + question key. */
  sectionKey?: string;
  fieldKey?: string;
  /** For row_table destinations: identifier of the target row + column. */
  rowId?: string;
  column?: string;
}

export interface ProposalRow {
  id: string;
  destination: ProposalDestination;
  fieldLabel: string;
  /** Hover-over text — e.g. "Ethics > Independence > Q3" */
  sourceLocation: string;
  proposedValue: string | number | boolean | null;
  deleted?: boolean;
  applied?: boolean;
}

// ─── Field provenance ───────────────────────────────────────────────
// Stored under __fieldmeta inside any tab's JSON `data` blob:
//   data.__fieldmeta = { [fieldKey]: { source, byUserId, byUserName, at, sourceLocation? } }

export type FieldProvenanceSource = 'prior_period_ai' | 'current_year_ai' | 'manual';

export interface FieldProvenance {
  source: FieldProvenanceSource;
  byUserId?: string;
  byUserName?: string;
  at: string;
  sourceLocation?: string;
}

export type FieldMetaMap = Record<string, FieldProvenance>;

/** Tabs that current-year AI population MUST NOT touch. */
export const AI_POPULATE_EXCLUDED_TABS = new Set(['rmm', 'tb']);

/** Built-in vendor entry seeded into every firm. The connection
 *  RECIPE is left empty — admins must fill in baseUrl/auth before the
 *  connector becomes usable. We do not pretend to know MyWorkPapers'
 *  endpoints because we have not been given their API spec. */
export const MY_WORKPAPERS_VENDOR_KEY = 'my_workpapers';

export function emptyMyWorkpapersConfig(): CloudConnectorConfig {
  return {
    baseUrl: '',
    authScheme: 'bearer',
    authConfig: {},
    endpoints: {},
    notes:
      'MyWorkPapers connection recipe is not pre-configured. A firm admin '
      + 'must enter the API base URL, authentication scheme, and endpoint '
      + 'paths from MyWorkPapers documentation before this connector can '
      + 'be used to fetch a prior audit file.',
  };
}
