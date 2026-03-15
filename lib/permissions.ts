import { User } from '@prisma/client';

export type UserRole = 'super_admin' | 'firm_admin' | 'portfolio_owner' | 'user';

export function getHighestRole(user: Pick<User, 'isSuperAdmin' | 'isFirmAdmin' | 'isPortfolioOwner'>): UserRole {
  if (user.isSuperAdmin) return 'super_admin';
  if (user.isFirmAdmin) return 'firm_admin';
  if (user.isPortfolioOwner) return 'portfolio_owner';
  return 'user';
}

export function canManageUsers(user: Pick<User, 'isSuperAdmin' | 'isFirmAdmin' | 'isPortfolioOwner'>): boolean {
  return user.isSuperAdmin || user.isFirmAdmin;
}

export function canManageClients(user: Pick<User, 'isSuperAdmin' | 'isFirmAdmin' | 'isPortfolioOwner'>): boolean {
  return user.isSuperAdmin || user.isFirmAdmin || user.isPortfolioOwner;
}

export function canManageSubscriptions(user: Pick<User, 'isSuperAdmin' | 'isFirmAdmin' | 'isPortfolioOwner'>): boolean {
  return user.isSuperAdmin || user.isFirmAdmin || user.isPortfolioOwner;
}

export function isSuperAdmin(user: Pick<User, 'isSuperAdmin'>): boolean {
  return user.isSuperAdmin;
}
