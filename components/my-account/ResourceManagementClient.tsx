'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Building2, FileText, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ResourceUserManagement } from './ResourceUserManagement';
import { ResourceClientSettings } from './ResourceClientSettings';
import { ResourceStaffSetup } from './ResourceStaffSetup';
import { ResourceJobProfiles } from './ResourceJobProfiles';
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
        </TabsList>

        <TabsContent value="staff-setup">
          <ResourceStaffSetup />
        </TabsContent>

        <TabsContent value="users">
          <ResourceUserManagement staff={staff} specialistRoles={specialistRoles} />
        </TabsContent>

        <TabsContent value="clients">
          <ResourceClientSettings clients={clients} profiles={profiles} firmId={firmId} />
        </TabsContent>

        <TabsContent value="profiles">
          <ResourceJobProfiles profiles={profiles} onProfilesChange={setProfiles} firmId={firmId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
