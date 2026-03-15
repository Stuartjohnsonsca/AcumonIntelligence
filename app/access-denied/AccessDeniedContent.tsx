'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ShoppingCart, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRODUCTS } from '@/lib/products';

export default function AccessDeniedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefix = searchParams.get('prefix') || '';

  const product = PRODUCTS.find((p) => p.urlPrefix === prefix);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50 px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-orange-100 rounded-2xl mb-6">
          <LockKeyhole className="h-10 w-10 text-orange-500" />
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-3">Access Required</h1>

        {product ? (
          <p className="text-lg text-slate-600 mb-2">
            You don&apos;t have an active subscription to{' '}
            <span className="font-semibold text-slate-800">{product.name}</span>.
          </p>
        ) : (
          <p className="text-lg text-slate-600 mb-2">
            You don&apos;t have access to this product.
          </p>
        )}

        <p className="text-slate-500 mb-8">
          Purchase a subscription to gain access. Once your firm administrator assigns the subscription
          to your client, you will be able to use this tool.
        </p>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6 text-left">
          <h2 className="font-semibold text-slate-800 mb-3">To get access:</h2>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start space-x-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
              <span>Your Firm Administrator or Portfolio Owner purchases a subscription</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
              <span>The subscription is assigned to a client you are working on</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
              <span>Return here and you will be granted access automatically</span>
            </li>
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => {
              const params = prefix ? `?prefix=${prefix}` : '';
              router.push(`/subscribe${params}`);
            }}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {product ? `Subscribe to ${product.name}` : 'View Subscriptions'}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/my-account">
              <ArrowLeft className="mr-2 h-4 w-4" />My Account
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
