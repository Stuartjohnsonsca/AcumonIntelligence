'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ShoppingCart, Check, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PRODUCTS } from '@/lib/products';
import { formatCurrency } from '@/lib/utils';

const QUANTITIES = [
  { qty: 1, label: '1 subscription' },
  { qty: 5, label: '5 subscriptions' },
  { qty: 10, label: '10 subscriptions' },
  { qty: 20, label: '20 subscriptions' },
];

const PRICE_KEYS: Record<number, 'price1' | 'price5' | 'price10' | 'price20'> = {
  1: 'price1',
  5: 'price5',
  10: 'price10',
  20: 'price20',
};

// Product prices hard-coded for client-side display (mirrors DB seed)
const PRODUCT_PRICES: Record<string, { price1: number; price5: number; price10: number; price20: number; expiryDays: number }> = {
  DateExtraction: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 60 },
  DocSummary: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 60 },
  PortfolioExtraction: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 60 },
  FSChecker: { price1: 75, price5: 350, price10: 625, price20: 1000, expiryDays: 30 },
  Sampling: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 60 },
  Governance: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 30 },
  CyberResiliance: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 30 },
  TalentRisk: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 30 },
  ESGSustainability: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 30 },
  Diversity: { price1: 50, price5: 240, price10: 450, price20: 875, expiryDays: 30 },
};

export default function SubscribePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPrefix = searchParams.get('prefix') || '';

  const [selectedProduct, setSelectedProduct] = useState(prefillPrefix || '');
  const [selectedQty, setSelectedQty] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  if (!session?.user?.twoFactorVerified) {
    router.push('/login?callbackUrl=/subscribe');
    return null;
  }

  const product = PRODUCTS.find((p) => p.urlPrefix === selectedProduct);
  const prices = selectedProduct ? PRODUCT_PRICES[selectedProduct] : null;
  const priceKey = PRICE_KEYS[selectedQty];
  const totalPrice = prices ? prices[priceKey] : 0;

  async function handleCheckout() {
    if (!selectedProduct) return;
    setLoading(true);

    // Stripe placeholder - in future this calls /api/stripe/create-checkout
    alert(`Stripe checkout coming soon!\n\nProduct: ${product?.name}\nQuantity: ${selectedQty}\nTotal: ${formatCurrency(totalPrice)}\n\nStripe integration will be added when payment keys are configured.`);
    setLoading(false);
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Purchase Subscriptions</h1>
        <p className="text-slate-600">Select a product and quantity to get started.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Product selector */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1. Select a product</CardTitle>
              <CardDescription>Choose which tool you want to subscribe to</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-2">
                {PRODUCTS.map((p) => (
                  <button
                    key={p.urlPrefix}
                    onClick={() => setSelectedProduct(p.urlPrefix)}
                    className={`text-left px-4 py-3 rounded-lg border-2 transition-all text-sm ${
                      selectedProduct === p.urlPrefix
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.name}</span>
                      {selectedProduct === p.urlPrefix && <Check className="h-4 w-4 text-blue-600" />}
                    </div>
                    <span className="text-xs text-slate-500">{p.category}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedProduct && prices && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">2. Select quantity</CardTitle>
                <CardDescription>
                  Each subscription grants one client access for {prices.expiryDays} days
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {QUANTITIES.map(({ qty, label }) => {
                    const key = PRICE_KEYS[qty];
                    const price = prices[key];
                    const perUnit = price / qty;
                    return (
                      <button
                        key={qty}
                        onClick={() => setSelectedQty(qty)}
                        className={`p-4 rounded-lg border-2 text-center transition-all ${
                          selectedQty === qty
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-xl font-bold text-slate-900">{qty}</div>
                        <div className="text-xs text-slate-500 mb-2">subscription{qty > 1 ? 's' : ''}</div>
                        <div className="text-base font-semibold text-blue-600">{formatCurrency(price)}</div>
                        {qty > 1 && (
                          <div className="text-xs text-green-600">{formatCurrency(perUnit)} each</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Order summary */}
        <div>
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {product && prices ? (
                <>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Product</span>
                      <span className="font-medium text-slate-900 text-right max-w-[60%]">{product.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Quantity</span>
                      <span className="font-medium">{selectedQty}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Duration</span>
                      <span className="font-medium">{prices.expiryDays} days</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between text-base">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold text-blue-600">{formatCurrency(totalPrice)}</span>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start space-x-2">
                    <Info className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                      Payment processing via Stripe will be enabled shortly. Your order details will be saved.
                    </p>
                  </div>

                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    onClick={handleCheckout}
                    disabled={loading}
                  >
                    {loading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                    ) : (
                      <><ShoppingCart className="mr-2 h-4 w-4" />Proceed to Checkout</>
                    )}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">
                  Select a product to see pricing
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
