'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ShoppingCart, Plus, Minus, Trash2, Loader2, Info, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';

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

interface BasketItem {
  product: Product;
  qty: number;
}

const QTY_OPTIONS = [1, 5, 10, 20] as const;
type Qty = (typeof QTY_OPTIONS)[number];

function priceForQty(product: Product, qty: Qty): number {
  const map: Record<Qty, number> = {
    1: product.price1,
    5: product.price5,
    10: product.price10,
    20: product.price20,
  };
  return map[qty];
}

export default function SubscribeContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPrefix = searchParams.get('prefix') || '';

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [basket, setBasket] = useState<Map<string, BasketItem>>(new Map());
  const [selectedQtys, setSelectedQtys] = useState<Map<string, Qty>>(new Map());
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then((data: Product[]) => {
        setProducts(data.filter(p => p.isActive !== false));
        setLoadingProducts(false);
      })
      .catch(() => setLoadingProducts(false));
  }, []);

  useEffect(() => {
    if (prefillPrefix && products.length > 0 && basket.size === 0) {
      const p = products.find(pr => pr.urlPrefix === prefillPrefix);
      if (p) {
        setBasket(new Map([[p.urlPrefix, { product: p, qty: 1 }]]));
      }
    }
  }, [prefillPrefix, products, basket.size]);

  if (!session?.user?.twoFactorVerified) {
    router.push('/login?callbackUrl=/subscribe');
    return null;
  }

  const getQty = (prefix: string): Qty => selectedQtys.get(prefix) ?? 1;

  const setQty = (prefix: string, qty: Qty) => {
    setSelectedQtys(prev => new Map(prev).set(prefix, qty));
  };

  const addToBasket = useCallback((product: Product) => {
    const qty = selectedQtys.get(product.urlPrefix) ?? 1;
    setBasket(prev => {
      const next = new Map(prev);
      const existing = next.get(product.urlPrefix);
      if (existing) {
        next.set(product.urlPrefix, { ...existing, qty });
      } else {
        next.set(product.urlPrefix, { product, qty });
      }
      return next;
    });
  }, [selectedQtys]);

  const removeFromBasket = useCallback((prefix: string) => {
    setBasket(prev => {
      const next = new Map(prev);
      next.delete(prefix);
      return next;
    });
  }, []);

  const basketItems = Array.from(basket.values());
  const grandTotal = basketItems.reduce((sum, item) =>
    sum + priceForQty(item.product, item.qty as Qty), 0
  );

  const categories = [...new Set(products.map(p => p.category))];

  if (confirmed) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl text-center">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-10 space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <ShoppingCart className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Order Received</h1>
          <p className="text-slate-600 max-w-md mx-auto">
            Your order has been recorded. Payment processing via Stripe will be enabled shortly.
            You will be notified when your subscriptions are activated.
          </p>
          <div className="bg-white rounded-xl border border-green-100 p-6 text-left max-w-md mx-auto">
            <p className="font-semibold text-slate-800 mb-3">Order Summary</p>
            <div className="space-y-2 text-sm">
              {basketItems.map(item => (
                <div key={item.product.urlPrefix} className="flex justify-between">
                  <span className="text-slate-600">{item.product.name} x{item.qty}</span>
                  <span className="font-medium">{formatCurrency(priceForQty(item.product, item.qty as Qty))}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between text-base font-bold">
                <span>Total</span>
                <span className="text-blue-600">{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </div>
          <Button onClick={() => router.push('/my-account')} className="mt-4">
            Go to My Account
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Purchase Subscriptions</h1>
        <p className="text-slate-600">Add products to your basket, then proceed to checkout.</p>
      </div>

      {loadingProducts ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Product catalogue */}
          <div className="lg:col-span-2 space-y-8">
            {categories.map(category => (
              <div key={category}>
                <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Package className="h-5 w-5 text-blue-500" />
                  {category === 'Internal Audit' ? 'Assurance' : category}
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {products.filter(p => p.category === category).map(product => {
                    const inBasket = basket.has(product.urlPrefix);
                    const currentQty = getQty(product.urlPrefix);
                    const price = priceForQty(product, currentQty);
                    return (
                      <Card key={product.urlPrefix} className={`transition-all ${inBasket ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-slate-800">{product.name}</p>
                              <p className="text-xs text-slate-500">{product.expiryDays} days per subscription</p>
                            </div>
                            {inBasket && <Badge className="bg-blue-100 text-blue-700 text-xs">In basket</Badge>}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {QTY_OPTIONS.map(q => (
                              <button
                                key={q}
                                onClick={() => setQty(product.urlPrefix, q)}
                                className={`flex-1 py-1.5 rounded text-xs font-medium transition-all ${
                                  currentQty === q
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                {q}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-lg font-bold text-blue-600">{formatCurrency(price)}</span>
                              {currentQty > 1 && (
                                <span className="text-xs text-green-600 ml-2">{formatCurrency(price / currentQty)} each</span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant={inBasket ? 'outline' : 'default'}
                              className={inBasket ? 'text-blue-600 border-blue-300' : 'bg-blue-600 hover:bg-blue-700'}
                              onClick={() => inBasket ? removeFromBasket(product.urlPrefix) : addToBasket(product)}
                            >
                              {inBasket ? (
                                <><Minus className="h-3.5 w-3.5 mr-1" />Remove</>
                              ) : (
                                <><Plus className="h-3.5 w-3.5 mr-1" />Add</>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Basket sidebar */}
          <div>
            <Card className="sticky top-20">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Basket
                  {basketItems.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">{basketItems.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {basketItems.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    Your basket is empty. Add products to get started.
                  </p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {basketItems.map(item => {
                        const itemPrice = priceForQty(item.product, item.qty as Qty);
                        return (
                          <div key={item.product.urlPrefix} className="flex items-start justify-between text-sm bg-slate-50 rounded-lg p-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-800 truncate">{item.product.name}</p>
                              <p className="text-xs text-slate-500">
                                {item.qty} x subscription ({item.product.expiryDays} days)
                              </p>
                              <p className="font-semibold text-blue-600 mt-0.5">{formatCurrency(itemPrice)}</p>
                            </div>
                            <button
                              onClick={() => removeFromBasket(item.product.urlPrefix)}
                              className="text-slate-400 hover:text-red-500 p-1 ml-2"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t pt-3 flex justify-between text-base">
                      <span className="font-semibold text-slate-800">Total</span>
                      <span className="font-bold text-blue-600">{formatCurrency(grandTotal)}</span>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                      <Info className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">
                        Payment via Stripe will be enabled shortly. Your order will be recorded.
                      </p>
                    </div>

                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={() => setConfirmed(true)}
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Proceed to Checkout ({formatCurrency(grandTotal)})
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
