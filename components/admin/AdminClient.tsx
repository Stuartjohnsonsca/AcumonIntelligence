'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsAdmin } from './ProductsAdmin';
import { FirmsAdmin } from './FirmsAdmin';
import { AggregatorConnectorsTab } from '../my-account/AggregatorConnectorsTab';
import { ActionTriggersAdmin } from './ActionTriggersAdmin';

export function AdminClient() {
  return (
    <Tabs defaultValue="products" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="products">Products</TabsTrigger>
        <TabsTrigger value="firms">Firms</TabsTrigger>
        <TabsTrigger value="aggregator-connectors">Aggregator Connectors</TabsTrigger>
        <TabsTrigger value="action-triggers">Action Triggers</TabsTrigger>
      </TabsList>
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
    </Tabs>
  );
}
