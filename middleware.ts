import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

const protectedRoutes = ['/my-account'];
const authRoutes = ['/login'];

export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;
  const isLoggedIn = !!session?.user;
  const twoFactorVerified = session?.user?.twoFactorVerified === true;
  const isAuthenticated = isLoggedIn && twoFactorVerified;

  const isProtectedRoute = protectedRoutes.some((route) =>
    nextUrl.pathname.startsWith(route)
  );

  // If trying to access protected route without being fully authenticated
  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL('/login', nextUrl);
    loginUrl.searchParams.set('callbackUrl', nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If logged in and tries to access auth pages, redirect to home
  if (isAuthenticated && authRoutes.some((r) => nextUrl.pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/my-account', nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
