import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const products = await prisma.product.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  return NextResponse.json(products);
}
