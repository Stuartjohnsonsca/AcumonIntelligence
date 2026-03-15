'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Calendar, Edit2, Check, X } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  category: string;
  urlPrefix: string;
  expiryDays: number;
  price1: number;
  price5: number;
  price10: number;
  price20: number;
  isActive: boolean;
}

export function ProductsAdmin() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showPriceChange, setShowPriceChange] = useState<string | null>(null);
  const [priceChangeForm, setPriceChangeForm] = useState({ effectiveDate: '', price1: '', price5: '', price10: '', price20: '' });
  const [saving, setSaving] = useState(false);

  async function loadProducts() {
    setLoading(true);
    const res = await fetch('/api/products');
    const data = await res.json();
    setProducts(data);
    setLoading(false);
  }

  useEffect(() => { loadProducts(); }, []);

  async function handlePriceChangeCommit(productId: string) {
    setSaving(true);
    await fetch(`/api/products/${productId}/price-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(priceChangeForm),
    });
    setShowPriceChange(null);
    setPriceChangeForm({ effectiveDate: '', price1: '', price5: '', price10: '', price20: '' });
    setSaving(false);
  }

  async function handleToggleActive(product: Product) {
    await fetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !product.isActive }),
    });
    await loadProducts();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-800">Products</h2>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="space-y-3">
          {products.map((p) => (
            <Card key={p.id} className={!p.isActive ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-semibold text-slate-800">{p.name}</span>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{p.category}</span>
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-mono">{p.urlPrefix}</span>
                      {!p.isActive && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Inactive</span>}
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-sm mt-2">
                      <div><span className="text-slate-500 text-xs">x1</span><br /><span className="font-medium">{formatCurrency(p.price1)}</span></div>
                      <div><span className="text-slate-500 text-xs">x5</span><br /><span className="font-medium">{formatCurrency(p.price5)}</span></div>
                      <div><span className="text-slate-500 text-xs">x10</span><br /><span className="font-medium">{formatCurrency(p.price10)}</span></div>
                      <div><span className="text-slate-500 text-xs">x20</span><br /><span className="font-medium">{formatCurrency(p.price20)}</span></div>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Expires in {p.expiryDays} days after activation</div>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <Button size="sm" variant="outline" onClick={() => { setShowPriceChange(p.id); setPriceChangeForm({ effectiveDate: '', price1: String(p.price1), price5: String(p.price5), price10: String(p.price10), price20: String(p.price20) }); }}>
                      <Calendar className="h-3.5 w-3.5 mr-1" />Schedule Price
                    </Button>
                    <Button size="sm" variant={p.isActive ? 'outline' : 'default'} onClick={() => handleToggleActive(p)}>
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>

                {showPriceChange === p.id && (
                  <div className="mt-4 pt-4 border-t border-slate-200">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">Schedule Price Change</h4>
                    <div className="grid sm:grid-cols-5 gap-3">
                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-xs">Effective Date</Label>
                        <Input type="date" value={priceChangeForm.effectiveDate} onChange={e => setPriceChangeForm({ ...priceChangeForm, effectiveDate: e.target.value })} min={new Date().toISOString().split('T')[0]} />
                      </div>
                      {(['price1', 'price5', 'price10', 'price20'] as const).map((key, i) => (
                        <div key={key} className="space-y-1">
                          <Label className="text-xs">x{[1,5,10,20][i]} Price (£)</Label>
                          <Input type="number" value={priceChangeForm[key]} onChange={e => setPriceChangeForm({ ...priceChangeForm, [key]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" onClick={() => handlePriceChangeCommit(p.id)} disabled={saving || !priceChangeForm.effectiveDate} className="bg-blue-600 hover:bg-blue-700">
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5 mr-1" />Commit</>}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowPriceChange(null)}>
                        <X className="h-3.5 w-3.5 mr-1" />Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
