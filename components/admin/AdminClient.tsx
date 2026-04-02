'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsAdmin } from './ProductsAdmin';
import { FirmsAdmin } from './FirmsAdmin';
import { SuperAdminsAdmin } from './SuperAdminsAdmin';

export function AdminClient() {
  return (
    <Tabs defaultValue="super-admins" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="super-admins">Super Admins</TabsTrigger>
        <TabsTrigger value="products">Products</TabsTrigger>
        <TabsTrigger value="firms">Firms</TabsTrigger>
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
    </Tabs>
  );
}
