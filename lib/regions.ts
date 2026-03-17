/**
 * Region configuration for data residency compliance.
 *
 * Currently all infrastructure is UK-based. When expanding internationally,
 * spin up regional infrastructure and add entries here. The firm's dataRegion
 * field determines which config block is used.
 *
 * Migration path for each new region:
 *   1. Create a Supabase project in the target region
 *   2. Create an Azure Storage account in the target region
 *   3. Configure Vertex AI with the target Google Cloud region
 *   4. Add the region entry below with connection details
 *   5. Set up cross-region Vercel function deployment (Enterprise plan)
 */

export type DataRegion = 'uk' | 'eu' | 'us' | 'ap';

export interface RegionConfig {
  label: string;
  vercelRegion: string;
  supabaseRegion: string;
  azureStorageRegion: string;
  geminiLocation: string;
  azureCommRegion: string;
}

const REGION_CONFIGS: Record<DataRegion, RegionConfig> = {
  uk: {
    label: 'United Kingdom',
    vercelRegion: 'lhr1',
    supabaseRegion: 'eu-west-2',       // London (target — currently eu-north-1, needs migration)
    azureStorageRegion: 'uksouth',
    geminiLocation: 'europe-west2',     // London (requires Vertex AI migration)
    azureCommRegion: 'uk',
  },
  eu: {
    label: 'European Union',
    vercelRegion: 'cdg1',              // Paris
    supabaseRegion: 'eu-west-1',       // Ireland
    azureStorageRegion: 'westeurope',   // Netherlands
    geminiLocation: 'europe-west4',     // Netherlands
    azureCommRegion: 'europe',
  },
  us: {
    label: 'United States',
    vercelRegion: 'iad1',              // Washington DC
    supabaseRegion: 'us-east-1',
    azureStorageRegion: 'eastus',
    geminiLocation: 'us-central1',
    azureCommRegion: 'unitedstates',
  },
  ap: {
    label: 'Asia Pacific',
    vercelRegion: 'hnd1',             // Tokyo
    supabaseRegion: 'ap-southeast-1', // Singapore
    azureStorageRegion: 'southeastasia',
    geminiLocation: 'asia-southeast1',
    azureCommRegion: 'asia',
  },
};

export const DEFAULT_REGION: DataRegion = 'uk';

export function getRegionConfig(region: string | null | undefined): RegionConfig {
  const key = (region || DEFAULT_REGION) as DataRegion;
  return REGION_CONFIGS[key] || REGION_CONFIGS[DEFAULT_REGION];
}

export function isValidRegion(region: string): region is DataRegion {
  return region in REGION_CONFIGS;
}

export function getAllRegions(): { id: DataRegion; label: string }[] {
  return Object.entries(REGION_CONFIGS).map(([id, config]) => ({
    id: id as DataRegion,
    label: config.label,
  }));
}
