'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Building2, FileText, ArrowLeft, Wand2, Database } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ResourceUserManagement } from './ResourceUserManagement';
import { ResourceClientSettings } from './ResourceClientSettings';
import { ResourceStaffSetup } from './ResourceStaffSetup';
import { ResourceJobProfiles } from './ResourceJobProfiles';
import { ResourceSeedData } from './ResourceSeedData';
import type { ResourceJobProfile } from '@/lib/resource-planning/types';

interface StaffData {
  id: string;
  displayId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  isActive: boolean;
  resourceSetting: any;
}

interface ClientData {
  id: string;
  clientName: string;
  resourceCategoryId: string | null;
  resourceCategoryName: string | null;
  serviceType: string | null;
  rollForwardTimeframe: string | null;
}

interface Props {
  staff: StaffData[];
  clients: ClientData[];
  profiles: ResourceJobProfile[];
  firmId: string;
  specialistRoles: string[];
}

export function ResourceManagementClient({ staff, clients, profiles: initialProfiles, firmId, specialistRoles }: Props) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [applyingDefaults, setApplyingDefaults] = useState(false);
  const [defaultsResult, setDefaultsResult] = useState<string | null>(null);

  async function handleApplyDefaults() {
    setApplyingDefaults(true);
    setDefaultsResult(null);
    try {
      const res = await fetch('/api/resource-planning/setup', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDefaultsResult(data.updated === 0
          ? data.message
          : `Updated ${data.updated} staff member${data.updated !== 1 ? 's' : ''}: ${data.names?.join(', ')}`
        );
      } else {
        setDefaultsResult(`Error: ${data.error}`);
      }
    } catch {
      setDefaultsResult('Failed to apply defaults');
    } finally {
      setApplyingDefaults(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/my-account" className="flex items-center gap-1 text-slate-600">
            <ArrowLeft className="h-4 w-4" />
            Back to My Account
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="staff-setup" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="staff-setup" className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            Staff Setup
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            User Settings
          </TabsTrigger>
          <TabsTrigger value="clients" className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" />
            Client Settings
          </TabsTrigger>
          <TabsTrigger value="profiles" className="flex items-center gap-1.5">
            <FileText className="h-4 w-4" />
            Job Resource Profiles
          </TabsTrigger>
          <TabsTrigger value="seed-data" className="flex items-center gap-1.5">
            <Database className="h-4 w-4" />
            Seed Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="staff-setup">
          <div className="mb-4 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleApplyDefaults}
              disabled={applyingDefaults}
              className="flex items-center gap-1.5 text-xs"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {applyingDefaults ? 'Applying…' : 'Apply Default Role Limits'}
            </Button>
            <span className="text-xs text-slate-500">
              Enables all roles (Preparer, Reviewer, RI) for staff who have no role limits set yet.
            </span>
            {defaultsResult && (
              <span className="text-xs text-green-700 font-medium">{defaultsResult}</span>
            )}
          </div>
          <ResourceStaffSetup />
        </TabsContent>

        <TabsContent value="users">
          <ResourceUserManagement staff={staff} specialistRoles={specialistRoles} />
        </TabsContent>

        <TabsContent value="clients">
          <ResourceClientSettings clients={clients} profiles={profiles} firmId={firmId} />
        </TabsContent>

        <TabsContent value="profiles">
          <ResourceJobProfiles profiles={profiles} onProfilesChange={setProfiles} firmId={firmId} specialistRoles={specialistRoles} />
        </TabsContent>

        <TabsContent value="seed-data">
          <ResourceSeedData />
        </TabsContent>
      </Tabs>
    </div>
  );
}
