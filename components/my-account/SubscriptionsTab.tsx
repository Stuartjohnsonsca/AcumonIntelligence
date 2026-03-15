'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Calendar, Package } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

interface Subscription {
  id: string;
  quantity: number;
  startDate: string;
  expiryDate: string;
  isActive: boolean;
  client: { clientName: string };
  product: { name: string; category: string };
}

interface Props {
  firmId: string;
  isSuperAdmin: boolean;
  isFirmAdmin: boolean;
  isPortfolioOwner: boolean;
}

export function SubscriptionsTab({ firmId, isSuperAdmin, isFirmAdmin, isPortfolioOwner }: Props) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/subscriptions?firmId=${firmId}`);
      const data = await res.json();
      setSubscriptions(data);
      setLoading(false);
    }
    load();
  }, [firmId]);

  const canAdd = isSuperAdmin || isFirmAdmin || isPortfolioOwner;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Subscriptions</h2>
        {canAdd && (
          <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
            <Link href="/subscribe"><Plus className="h-4 w-4 mr-1" />Add Subscription</Link>
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <div className="space-y-2">
          {subscriptions.map((s) => {
            const isExpired = new Date(s.expiryDate) < new Date();
            return (
              <div key={s.id} className="p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Package className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-slate-800">{s.product.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          isExpired ? 'bg-red-100 text-red-700' : s.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {isExpired ? 'Expired' : s.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 mt-0.5">
                        Client: <span className="font-medium">{s.client.clientName}</span>
                      </div>
                      <div className="flex items-center space-x-3 mt-1">
                        <span className="text-xs text-slate-400 flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {formatDate(s.startDate)} – {formatDate(s.expiryDate)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {s.quantity} subscription{s.quantity !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {subscriptions.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <Package className="h-12 w-12 mx-auto text-slate-300 mb-3" />
              <p>No subscriptions yet.</p>
              {canAdd && (
                <Button asChild className="mt-4 bg-blue-600 hover:bg-blue-700">
                  <Link href="/subscribe">Purchase a subscription</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
