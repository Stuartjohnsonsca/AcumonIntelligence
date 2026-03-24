'use client';

import { useState, useEffect } from 'react';
import type { ContactData } from '@/hooks/useEngagement';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
  initialContacts: ContactData[];
}

export function ClientContactsPanel({ engagementId, initialContacts }: Props) {
  const [contacts, setContacts] = useState<ContactData[]>(initialContacts);

  useEffect(() => { setContacts(initialContacts); }, [initialContacts]);

  const { saving, lastSaved } = useAutoSave(
    `/api/engagements/${engagementId}/contacts`,
    { contacts },
    { enabled: contacts !== initialContacts }
  );

  function addContact() {
    setContacts(prev => [...prev, {
      id: '',
      name: '',
      email: '',
      phone: '',
      isMainContact: prev.length === 0,
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

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 h-full">
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

      <div className="space-y-3 max-h-[400px] overflow-auto">
        {contacts.length === 0 && (
          <p className="text-xs text-slate-400 italic">No contacts added yet</p>
        )}
        {contacts.map((contact, i) => (
          <div key={contact.id || `new-${i}`} className={`p-2 rounded border ${contact.isMainContact ? 'border-blue-300 bg-blue-50/30' : 'border-slate-100'}`}>
            <div className="flex items-center justify-between mb-1">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  checked={contact.isMainContact}
                  onChange={() => updateContact(i, 'isMainContact', true)}
                  className="w-3 h-3"
                />
                <span className={contact.isMainContact ? 'text-blue-600 font-medium' : 'text-slate-500'}>Main Contact</span>
              </label>
              <button onClick={() => removeContact(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={contact.name}
                onChange={e => updateContact(i, 'name', e.target.value)}
                placeholder="Name"
                className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
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
        ))}
      </div>
    </div>
  );
}
