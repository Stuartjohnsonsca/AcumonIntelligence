'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsAdmin } from './ProductsAdmin';
import { FirmsAdmin } from './FirmsAdmin';

export function AdminClient() {
  return (
    <Tabs defaultValue="products" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="products">Products</TabsTrigger>
        <TabsTrigger value="firms">Firms</TabsTrigger>
      </TabsList>
      <TabsContent value="products">
        <ProductsAdmin />
      </TabsContent>
      <TabsContent value="firms">
        <FirmsAdmin />
      </TabsContent>
    </Tabs>
  );
}
