'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersTab } from './UsersTab';
import { ClientsTab } from './ClientsTab';
import { SubscriptionsTab } from './SubscriptionsTab';
import { AiUsageTab } from './AiUsageTab';
import { FirmSettingsTab } from './FirmSettingsTab';
import { Shield, BookOpen, Keyboard, Users } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface Props {
  userId: string;
  firmId: string;
  isSuperAdmin: boolean;
  isFirmAdmin: boolean;
  isPortfolioOwner: boolean;
  isMethodologyAdmin: boolean;
  isResourceAdmin: boolean;
}

export function MyAccountClient({ userId, firmId, isSuperAdmin, isFirmAdmin, isPortfolioOwner, isMethodologyAdmin, isResourceAdmin }: Props) {
  const canManageUsers = isSuperAdmin || isFirmAdmin;
  const canManageClients = isSuperAdmin || isFirmAdmin || isPortfolioOwner;

  const defaultTab = canManageUsers ? 'users' : canManageClients ? 'clients' : 'subscriptions';

  return (
    <div>
      {isSuperAdmin && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">Super Administrator access</span>
          </div>
          <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
            <Link href="/my-account/admin">Administration Panel</Link>
          </Button>
        </div>
      )}

      {(isMethodologyAdmin || isSuperAdmin) && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-800">Methodology Administrator</span>
          </div>
          <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700">
            <Link href="/methodology-admin">Methodology Admin</Link>
          </Button>
        </div>
      )}

      {(isResourceAdmin || isSuperAdmin) && (
        <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-medium text-indigo-800">Resource Management</span>
          </div>
          <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700">
            <Link href="/my-account/resource-management">Manage Resources</Link>
          </Button>
        </div>
      )}

      <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Keyboard className="h-5 w-5 text-slate-600" />
          <span className="text-sm font-medium text-slate-700">Keyboard Shortcuts Reference</span>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/my-account/keyboard-shortcuts">View Shortcuts</Link>
        </Button>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="mb-6">
          {canManageUsers && <TabsTrigger value="users">Users</TabsTrigger>}
          {canManageClients && <TabsTrigger value="clients">Clients</TabsTrigger>}
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          {canManageClients && <TabsTrigger value="ai-usage">AI Usage</TabsTrigger>}
          {(isSuperAdmin || isFirmAdmin) && <TabsTrigger value="firm-settings">Firm Settings</TabsTrigger>}
        </TabsList>

        {canManageUsers && (
          <TabsContent value="users">
            <UsersTab firmId={firmId} isSuperAdmin={isSuperAdmin} currentUserId={userId} />
          </TabsContent>
        )}

        {canManageClients && (
          <TabsContent value="clients">
            <ClientsTab firmId={firmId} isPortfolioOwner={isPortfolioOwner} isFirmAdmin={isFirmAdmin} isSuperAdmin={isSuperAdmin} />
          </TabsContent>
        )}

        <TabsContent value="subscriptions">
          <SubscriptionsTab firmId={firmId} isSuperAdmin={isSuperAdmin} isFirmAdmin={isFirmAdmin} isPortfolioOwner={isPortfolioOwner} />
        </TabsContent>

        {canManageClients && (
          <TabsContent value="ai-usage">
            <AiUsageTab />
          </TabsContent>
        )}

        {(isSuperAdmin || isFirmAdmin) && (
          <TabsContent value="firm-settings">
            <FirmSettingsTab firmId={firmId} isFirmAdmin={isSuperAdmin || isFirmAdmin} />
          </TabsContent>
        )}

      </Tabs>
    </div>
  );
}
