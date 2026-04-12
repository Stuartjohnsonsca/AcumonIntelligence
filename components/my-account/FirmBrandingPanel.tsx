'use client';

/**
 * Firm branding / letterhead settings panel.
 * Renders under "Firm Settings" → gates on isFirmAdmin.
 * Manages two logos (firm + parent/group), regulatory fields, and the
 * letterhead header/footer wording drawn on every page of client letter PDFs.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Upload, Save, Trash2, Image as ImageIcon, Eye, Wand2 } from 'lucide-react';

interface FirmBranding {
  id: string;
  name: string;
  logoStoragePath: string | null;
  groupLogoStoragePath: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  registeredCompanyNumber: string | null;
  statutoryAuditorNumber: string | null;
  legalStatus: string | null;
  registeredOfficeAddress: string | null;
  vatNumber: string | null;
  letterheadHeaderText: string | null;
  letterheadFooterText: string | null;
}

export function FirmBrandingPanel() {
  const [firm, setFirm] = useState<FirmBranding | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [groupLogoUrl, setGroupLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<'primary' | 'group' | null>(null);
  const primaryInputRef = useRef<HTMLInputElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/firm/branding');
      if (res.ok) {
        const data = await res.json();
        setFirm(data.firm);
        setLogoUrl(data.logoUrl);
        setGroupLogoUrl(data.groupLogoUrl);
      }
    } catch { /* non-fatal */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function setField<K extends keyof FirmBranding>(key: K, value: FirmBranding[K]) {
    setFirm(prev => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!firm) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/firm/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: firm.address,
          phone: firm.phone,
          email: firm.email,
          website: firm.website,
          registeredCompanyNumber: firm.registeredCompanyNumber,
          statutoryAuditorNumber: firm.statutoryAuditorNumber,
          legalStatus: firm.legalStatus,
          registeredOfficeAddress: firm.registeredOfficeAddress,
          vatNumber: firm.vatNumber,
          letterheadHeaderText: firm.letterheadHeaderText,
          letterheadFooterText: firm.letterheadFooterText,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  async function uploadLogo(slot: 'primary' | 'group', file: File) {
    setUploadingSlot(slot);
    try {
      const fd = new FormData();
      fd.append('slot', slot);
      fd.append('file', file);
      const res = await fetch('/api/firm/branding', { method: 'POST', body: fd });
      if (res.ok) {
        await load();
      }
    } catch { /* non-fatal */ }
    setUploadingSlot(null);
  }

  async function removeLogo(slot: 'primary' | 'group') {
    if (!confirm(`Remove the ${slot === 'primary' ? 'firm' : 'group'} logo?`)) return;
    await fetch(`/api/firm/branding?slot=${slot}`, { method: 'DELETE' });
    await load();
  }

  function generateDefaults() {
    if (!firm) return;
    const parts: string[] = [];
    if (firm.name) parts.push(firm.name);
    if (firm.address) parts.push(firm.address);
    const contactLine: string[] = [];
    if (firm.phone) contactLine.push(firm.phone);
    if (firm.email) contactLine.push(firm.email);
    if (firm.website) contactLine.push(firm.website);
    if (contactLine.length) parts.push(contactLine.join('  |  '));
    const headerText = parts.join('\n');

    const footerParts: string[] = [];
    const companyLine: string[] = [firm.name || ''];
    if (firm.legalStatus) companyLine.push(`(${firm.legalStatus})`);
    if (firm.registeredCompanyNumber) {
      companyLine.push(`is a company registered in England and Wales, company number ${firm.registeredCompanyNumber}.`);
    }
    if (companyLine.filter(Boolean).length) footerParts.push(companyLine.filter(Boolean).join(' '));
    if (firm.registeredOfficeAddress) footerParts.push(`Registered office: ${firm.registeredOfficeAddress.replace(/\n/g, ', ')}.`);
    if (firm.statutoryAuditorNumber) {
      footerParts.push(`Registered to carry on audit work in the UK by the Institute of Chartered Accountants in England and Wales, firm number ${firm.statutoryAuditorNumber}.`);
    }
    if (firm.vatNumber) footerParts.push(`VAT number: ${firm.vatNumber}.`);
    const footerText = footerParts.join(' ');

    setFirm(prev => (prev ? { ...prev, letterheadHeaderText: headerText, letterheadFooterText: footerText } : prev));
  }

  if (loading || !firm) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading branding…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <ImageIcon className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-700">Letterhead &amp; Branding</h3>
        {saved && <span className="text-xs text-green-600 font-medium ml-2">Saved ✓</span>}
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Configure firm logos, regulatory info, and the letterhead header/footer wording that appears on every page of client-facing letters (planning letter, etc.).
        You own the wording of the header and footer — make sure they meet your regulator&apos;s requirements.
      </p>

      {/* ─── Logos ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <LogoSlot
          label="Firm logo"
          hint="Primary logo shown top-left of every letter."
          url={logoUrl}
          uploading={uploadingSlot === 'primary'}
          onPick={() => primaryInputRef.current?.click()}
          onRemove={firm.logoStoragePath ? () => removeLogo('primary') : undefined}
        />
        <input
          ref={primaryInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo('primary', f); e.target.value = ''; }}
        />
        <LogoSlot
          label="Group / parent logo (optional)"
          hint="Second logo for firms belonging to an international group."
          url={groupLogoUrl}
          uploading={uploadingSlot === 'group'}
          onPick={() => groupInputRef.current?.click()}
          onRemove={firm.groupLogoStoragePath ? () => removeLogo('group') : undefined}
        />
        <input
          ref={groupInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo('group', f); e.target.value = ''; }}
        />
      </div>

      {/* ─── Regulatory fields ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <TextField label="Address (street)" value={firm.address} onChange={v => setField('address', v)} multiline />
        <TextField label="Registered office address" value={firm.registeredOfficeAddress} onChange={v => setField('registeredOfficeAddress', v)} multiline />
        <TextField label="Phone" value={firm.phone} onChange={v => setField('phone', v)} />
        <TextField label="Email" value={firm.email} onChange={v => setField('email', v)} />
        <TextField label="Website" value={firm.website} onChange={v => setField('website', v)} />
        <SelectField label="Legal status" value={firm.legalStatus} onChange={v => setField('legalStatus', v)}
          options={['', 'Ltd', 'LLP', 'Partnership', 'Sole Trader']} />
        <TextField label="Registered company number" value={firm.registeredCompanyNumber} onChange={v => setField('registeredCompanyNumber', v)} />
        <TextField label="Statutory auditor / ICAEW firm number" value={firm.statutoryAuditorNumber} onChange={v => setField('statutoryAuditorNumber', v)} />
        <TextField label="VAT number" value={firm.vatNumber} onChange={v => setField('vatNumber', v)} />
      </div>

      {/* ─── Letterhead wording ──────────────────────────────────────────── */}
      <div className="mb-4 border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-slate-700">Letterhead wording (drawn on every page)</h4>
          <button
            type="button"
            onClick={generateDefaults}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
            title="Pre-fill header + footer from the regulatory fields above"
          >
            <Wand2 className="h-3.5 w-3.5" /> Generate from fields
          </button>
        </div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Header text (under/beside the logos)</label>
        <textarea
          value={firm.letterheadHeaderText ?? ''}
          onChange={(e) => setField('letterheadHeaderText', e.target.value)}
          rows={4}
          className="w-full text-sm px-3 py-2 border border-red-400 rounded-md font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-300"
          placeholder={'Acme LLP\n1 High Street, London\n020 1234 5678  |  mail@acme.co.uk  |  www.acme.co.uk'}
        />
        <label className="block text-xs font-medium text-slate-600 mt-3 mb-1">Footer text (regulatory block — appears on every page)</label>
        <textarea
          value={firm.letterheadFooterText ?? ''}
          onChange={(e) => setField('letterheadFooterText', e.target.value)}
          rows={4}
          className="w-full text-sm px-3 py-2 border border-red-400 rounded-md font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-300"
          placeholder={'Acme LLP is a limited liability partnership registered in England and Wales, number OC123456. Registered office: …'}
        />
        <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1">
          <Eye className="h-3 w-3" /> These texts appear on client letters.
        </p>
      </div>

      {/* ─── Preview ─────────────────────────────────────────────────────── */}
      <div className="mb-4 border border-slate-200 rounded-lg p-4 bg-slate-50">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Letterhead preview</p>
        <div className="bg-white border border-slate-300 rounded shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {logoUrl ? <img src={logoUrl} alt="Firm logo" className="max-h-12" /> : <div className="h-12 w-20 bg-slate-100 border border-dashed border-slate-300 rounded flex items-center justify-center text-[10px] text-slate-400">Firm</div>}
              {groupLogoUrl && <img src={groupLogoUrl} alt="Group logo" className="max-h-10" />}
            </div>
            <pre className="text-[10px] text-slate-600 whitespace-pre-wrap text-right font-sans leading-snug">
              {firm.letterheadHeaderText || ''}
            </pre>
          </div>
          <div className="px-6 py-6 text-[10px] text-slate-400 italic">…letter body…</div>
          <div className="px-6 py-3 border-t border-slate-200 text-[9px] text-slate-500 whitespace-pre-wrap leading-snug">
            {firm.letterheadFooterText || ''}
          </div>
        </div>
      </div>

      {/* ─── Save ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save branding
        </button>
      </div>
    </div>
  );
}

function LogoSlot({
  label, hint, url, uploading, onPick, onRemove,
}: {
  label: string;
  hint: string;
  url: string | null;
  uploading: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
      <p className="text-xs font-medium text-slate-700 mb-0.5">{label}</p>
      <p className="text-[11px] text-slate-400 mb-2">{hint}</p>
      <div className="h-24 bg-white border border-dashed border-slate-300 rounded mb-2 flex items-center justify-center overflow-hidden">
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[11px] text-slate-400">No logo uploaded</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onPick}
          disabled={uploading}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {url ? 'Replace' : 'Upload'}
        </button>
        {onRemove && (
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function TextField({
  label, value, onChange, multiline,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full text-sm px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      ) : (
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      )}
    </div>
  );
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white"
      >
        {options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
      </select>
    </div>
  );
}
