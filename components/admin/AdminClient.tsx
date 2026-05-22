'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsAdmin } from './ProductsAdmin';
import { FirmsAdmin } from './FirmsAdmin';
import { AggregatorConnectorsTab } from '../my-account/AggregatorConnectorsTab';
import { ActionTriggersAdmin } from './ActionTriggersAdmin';
import { SuperAdminsAdmin } from './SuperAdminsAdmin';
import { AuditTrailAdmin } from './AuditTrailAdmin';
import { MessagingProvidersClient } from './MessagingProvidersClient';
import { MessagingUsageAdmin } from './MessagingUsageAdmin';
import { CloneEngagementAdmin } from './CloneEngagementAdmin';

export function AdminClient() {
  return (
    <Tabs defaultValue="super-admins" className="w-full">
      <TabsList className="mb-6 flex-wrap h-auto">
        <TabsTrigger value="super-admins">Super Admins</TabsTrigger>
        <TabsTrigger value="products">Products</TabsTrigger>
        <TabsTrigger value="firms">Firms</TabsTrigger>
        <TabsTrigger value="aggregator-connectors">Aggregator Connectors</TabsTrigger>
        <TabsTrigger value="action-triggers">Action Triggers</TabsTrigger>
        <TabsTrigger value="messaging-providers">Messaging Providers</TabsTrigger>
        <TabsTrigger value="messaging-usage">Messaging Usage</TabsTrigger>
        <TabsTrigger value="audit-trail">Audit Trail</TabsTrigger>
        <TabsTrigger value="clone-engagement">Clone Engagement</TabsTrigger>
      </TabsList>
      <TabsContent value="super-admins">
        <SuperAdminsAdmin />
      </TabsContent>
      <TabsContent value="products">
        <ProductsAdmin />
      </TabsContent>
      <TabsContent value="firms">
        <FirmsAdmin />
      </TabsContent>
      <TabsContent value="aggregator-connectors">
        <AggregatorConnectorsTab firmId="" />
      </TabsContent>
      <TabsContent value="action-triggers">
        <ActionTriggersAdmin />
      </TabsContent>
      <TabsContent value="messaging-providers">
        <div className="space-y-2 mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Messaging Providers</h2>
          <p className="text-xs text-slate-500">
            Platform-wide credentials for SMS / WhatsApp / Telegram / WeChat (WeCom). Stored in <code>messaging_provider_configs</code>; the messaging library reads at send time with a 60-second in-memory cache (admin saves invalidate it immediately). Each provider falls back to environment variables when its DB row is disabled.
          </p>
        </div>
        <MessagingProvidersClient />
      </TabsContent>
      <TabsContent value="messaging-usage">
        <MessagingUsageAdmin />
      </TabsContent>
      <TabsContent value="audit-trail">
        <AuditTrailAdmin />
      </TabsContent>
      <TabsContent value="clone-engagement">
        <CloneEngagementAdmin />
      </TabsContent>
    </Tabs>
  );
}
