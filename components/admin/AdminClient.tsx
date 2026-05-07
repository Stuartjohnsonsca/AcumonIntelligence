'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsAdmin } from './ProductsAdmin';
import { FirmsAdmin } from './FirmsAdmin';
import { AggregatorConnectorsTab } from '../my-account/AggregatorConnectorsTab';
import { ActionTriggersAdmin } from './ActionTriggersAdmin';
import { SuperAdminsAdmin } from './SuperAdminsAdmin';
import { AuditTrailAdmin } from './AuditTrailAdmin';

export function AdminClient() {
  return (
    <Tabs defaultValue="super-admins" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="super-admins">Super Admins</TabsTrigger>
        <TabsTrigger value="products">Products</TabsTrigger>
        <TabsTrigger value="firms">Firms</TabsTrigger>
        <TabsTrigger value="aggregator-connectors">Aggregator Connectors</TabsTrigger>
        <TabsTrigger value="action-triggers">Action Triggers</TabsTrigger>
        <TabsTrigger value="audit-trail">Audit Trail</TabsTrigger>
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
      <TabsContent value="audit-trail">
        <AuditTrailAdmin />
      </TabsContent>
    </Tabs>
  );
}
