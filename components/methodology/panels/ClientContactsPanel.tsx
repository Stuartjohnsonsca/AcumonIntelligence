'use client';

import { useState, useEffect } from 'react';
import type { ContactData } from '@/hooks/useEngagement';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
  clientId: string;
  initialContacts: ContactData[];
}

export function ClientContactsPanel({ engagementId, clientId, initialContacts }: Props) {
  const [contacts, setContacts] = useState<ContactData[]>(initialContacts);
  const [portalLoading, setPortalLoading] = useState<Record<number, boolean>>({});
  const [portalError, setPortalError] = useState('');

  useEffect(() => { setContacts(initialContacts); }, [initialContacts]);

  // Load portal users to set portalAccess checkboxes on mount
  useEffect(() => {
    async function loadPortalUsers() {
      try {
        const res = await fetch(`/api/portal/users?clientId=${clientId}`);
        if (res.ok) {
          const users = await res.json();
          const activeEmails = new Set(
            (Array.isArray(users) ? users : [])
              .filter((u: any) => u.isActive)
              .map((u: any) => u.email?.toLowerCase())
          );
          setContacts(prev => prev.map(c => ({
            ...c,
            portalAccess: c.email ? activeEmails.has(c.email.toLowerCase()) : false,
          })));
        }
      } catch {}
    }
    if (clientId) loadPortalUsers();
  }, [clientId, initialContacts]);

  // Strip portalAccess before saving — it's not a DB field on AuditClientContact
  const contactsForSave = contacts.map(({ portalAccess, ...rest }) => rest);
  const initialForSave = initialContacts.map(({ portalAccess, ...rest }) => rest);

  const { saving, lastSaved } = useAutoSave(
    `/api/engagements/${engagementId}/contacts`,
    { contacts: contactsForSave },
    { enabled: JSON.stringify(contactsForSave) !== JSON.stringify(initialForSave) }
  );

  function addContact() {
    setContacts(prev => [...prev, {
      id: '',
      name: '',
      email: '',
      phone: '',
      isMainContact: prev.length === 0,
      portalAccess: false,
    }]);
  }

  function updateContact(index: number, field: keyof ContactData, value: string | boolean) {
    setContacts(prev => prev.map((c, i) => {
      if (i === index) return { ...c, [field]: value };
      // If setting main contact, unset others
      if (field === 'isMainContact' && value === true) return { ...c, isMainContact: false };
      return c;
    }));
  }

  function removeContact(index: number) {
    setContacts(prev => prev.filter((_, i) => i !== index));
  }

  async function handlePortalToggle(index: number, checked: boolean) {
    const contact = contacts[index];
    if (!contact.email?.trim()) {
      setPortalError('Email address is required for portal access');
      setTimeout(() => setPortalError(''), 3000);
      return;
    }
    if (!contact.name?.trim()) {
      setPortalError('Name is required for portal access');
      setTimeout(() => setPortalError(''), 3000);
      return;
    }

    setPortalLoading(prev => ({ ...prev, [index]: true }));
    setPortalError('');

    try {
      if (checked) {
        // Create portal user
        const res = await fetch('/api/portal/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            email: contact.email,
            name: contact.name,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to create portal access');
        }
      } else {
        // Deactivate portal user
        const res = await fetch('/api/portal/users', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            email: contact.email,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to remove portal access');
        }
      }
      updateContact(index, 'portalAccess', checked);
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Portal access update failed');
      setTimeout(() => setPortalError(''), 5000);
    } finally {
      setPortalLoading(prev => ({ ...prev, [index]: false }));
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Client Contacts</h3>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          <button onClick={addContact} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
            + Add Contact
          </button>
        </div>
      </div>

      {portalError && (
        <div className="mb-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{portalError}</div>
      )}

      <div className="space-y-2 max-h-[250px] overflow-auto">
        {contacts.length === 0 && (
          <p className="text-xs text-slate-400 italic">No contacts added yet</p>
        )}
        {contacts.map((contact, i) => (
          <div key={contact.id || `new-${i}`} className={`p-2 rounded border ${contact.isMainContact ? 'border-blue-300 bg-blue-50/30' : 'border-slate-100'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={contact.isMainContact}
                    onChange={() => updateContact(i, 'isMainContact', true)}
                    className="w-3 h-3"
                  />
                  <span className={contact.isMainContact ? 'text-blue-600 font-medium' : 'text-slate-500'}>Main Contact</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={contact.portalAccess ?? false}
                    onChange={(e) => handlePortalToggle(i, e.target.checked)}
                    disabled={portalLoading[i]}
                    className="w-3 h-3 rounded border-slate-300"
                  />
                  <span className={`${contact.portalAccess ? 'text-green-600 font-medium' : 'text-slate-400'} ${portalLoading[i] ? 'animate-pulse' : ''}`}>
                    {portalLoading[i] ? 'Updating...' : 'Portal Access'}
                  </span>
                </label>
              </div>
              <button onClick={() => removeContact(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
            </div>
            <div className="space-y-1.5">
              <input
                type="text"
                value={contact.name}
                onChange={e => updateContact(i, 'name', e.target.value)}
                placeholder="Name"
                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="email"
                  value={contact.email || ''}
                  onChange={e => updateContact(i, 'email', e.target.value)}
                  placeholder="Email"
                  className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <input
                  type="tel"
                  value={contact.phone || ''}
                  onChange={e => updateContact(i, 'phone', e.target.value)}
                  placeholder="Phone"
                  className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
