import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from')?.toUpperCase();
  const to = searchParams.get('to')?.toUpperCase();
  const date = searchParams.get('date');

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to currency codes required' }, { status: 400 });
  }

  if (from === to) {
    return NextResponse.json({ rate: 1, source: 'identity' });
  }

  // Try frankfurter.app (free, no key required, ECB data)
  try {
    const dateParam = date || 'latest';
    const url = `https://api.frankfurter.app/${dateParam}?from=${from}&to=${to}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      if (data.rates?.[to]) {
        return NextResponse.json({ rate: data.rates[to], source: 'frankfurter.app (ECB)', date: data.date });
      }
    }
  } catch { /* fall through */ }

  // Fallback: open.er-api.com (free tier)
  try {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      if (data.rates?.[to]) {
        return NextResponse.json({ rate: data.rates[to], source: 'open.er-api.com', date: data.time_last_update_utc?.slice(0, 10) || null });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ error: 'Unable to fetch exchange rate', rate: null, source: null }, { status: 502 });
}
