import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchAuditDeptUsers, type ADUser } from '@/lib/microsoft-graph';
import crypto from 'crypto';

// Users to always include regardless of department
const ALWAYS_INCLUDE_NAMES = [
  'stuart thomson',
  'david cartwright',
  'thanzil khan',
];

interface SyncAction {
  action: 'create' | 'update' | 'deactivate' | 'unchanged';
  adUser: ADUser;
  dbUserId?: string;
  changes?: Record<string, { from: string | null; to: string | null }>;
}

function generateDisplayId(name: string, existing: Set<string>): string {
  const parts = name.trim().split(/\s+/);
  const prefix = (
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase()
  );

  for (let i = 1; i <= 999; i++) {
    const candidate = `${prefix}${String(i).padStart(3, '0')}`;
    if (!existing.has(candidate)) {
      existing.add(candidate);
      return candidate;
    }
  }
  // Fallback with random suffix
  return `${prefix}${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function computeSyncActions(firmId: string): Promise<SyncAction[]> {
  // Fetch AD users (filtered: Audit dept + specific people)
  const adUsers = await fetchAuditDeptUsers();

  // Also check always-include by name from all AD users if not already found
  // The fetchAuditDeptUsers already handles email-based includes;
  // we also need name-based matching
  const filteredUsers = adUsers.filter(u => {
    if (u.department?.toLowerCase().includes('audit')) return true;
    const name = u.displayName?.toLowerCase() || '';
    if (ALWAYS_INCLUDE_NAMES.some(n => name.includes(n))) return true;
    return false;
  });

  // Get all existing users in this firm
  const dbUsers = await prisma.user.findMany({
    where: { firmId },
    select: {
      id: true, email: true, name: true, entraObjectId: true,
      jobTitle: true, department: true, officeLocation: true, isActive: true,
    },
  });

  // Get existing display IDs
  const existingDisplayIds = new Set(
    (await prisma.user.findMany({ select: { displayId: true } })).map(u => u.displayId)
  );

  // Index DB users by entraObjectId and email
  const byObjectId = new Map(dbUsers.filter(u => u.entraObjectId).map(u => [u.entraObjectId!, u]));
  const byEmail = new Map(dbUsers.map(u => [u.email.toLowerCase(), u]));

  const actions: SyncAction[] = [];
  const processedDbIds = new Set<string>();

  for (const adUser of filteredUsers) {
    const email = (adUser.mail || adUser.userPrincipalName || '').toLowerCase();
    if (!email) continue;

    // Find matching DB user
    const dbUser = byObjectId.get(adUser.id) || byEmail.get(email);

    if (dbUser) {
      processedDbIds.add(dbUser.id);

      // Check for changes
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if (dbUser.name !== adUser.displayName) changes.name = { from: dbUser.name, to: adUser.displayName };
      if ((dbUser.jobTitle || null) !== (adUser.jobTitle || null)) changes.jobTitle = { from: dbUser.jobTitle, to: adUser.jobTitle };
      if ((dbUser.department || null) !== (adUser.department || null)) changes.department = { from: dbUser.department, to: adUser.department };
      if ((dbUser.officeLocation || null) !== (adUser.officeLocation || null)) changes.officeLocation = { from: dbUser.officeLocation, to: adUser.officeLocation };
      if (!dbUser.entraObjectId) changes.entraObjectId = { from: null, to: adUser.id };
      if (!dbUser.isActive && adUser.accountEnabled) changes.isActive = { from: 'false', to: 'true' };
      if (dbUser.isActive && !adUser.accountEnabled) changes.isActive = { from: 'true', to: 'false' };

      if (Object.keys(changes).length > 0) {
        actions.push({ action: 'update', adUser, dbUserId: dbUser.id, changes });
      } else {
        actions.push({ action: 'unchanged', adUser, dbUserId: dbUser.id });
      }
    } else {
      // New user
      actions.push({ action: 'create', adUser });
    }
  }

  // Check for DB users with entraObjectId not in AD (potential leavers)
  // Only flag those who have an entraObjectId (were previously synced)
  for (const dbUser of dbUsers) {
    if (processedDbIds.has(dbUser.id)) continue;
    if (!dbUser.entraObjectId) continue; // Never synced — don't touch
    if (!dbUser.isActive) continue; // Already inactive

    actions.push({
      action: 'deactivate',
      adUser: {
        id: dbUser.entraObjectId,
        displayName: dbUser.name,
        mail: dbUser.email,
        userPrincipalName: dbUser.email,
        jobTitle: dbUser.jobTitle,
        department: dbUser.department,
        mobilePhone: null,
        businessPhones: [],
        employeeId: null,
        officeLocation: dbUser.officeLocation,
        accountEnabled: false,
      },
      dbUserId: dbUser.id,
    });
  }

  return actions;
}

// GET — Preview mode (dry run)
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  try {
    const actions = await computeSyncActions(session.user.firmId);

    return NextResponse.json({
      preview: true,
      summary: {
        create: actions.filter(a => a.action === 'create').length,
        update: actions.filter(a => a.action === 'update').length,
        deactivate: actions.filter(a => a.action === 'deactivate').length,
        unchanged: actions.filter(a => a.action === 'unchanged').length,
      },
      actions: actions.map(a => ({
        action: a.action,
        name: a.adUser.displayName,
        email: a.adUser.mail || a.adUser.userPrincipalName,
        jobTitle: a.adUser.jobTitle,
        department: a.adUser.department,
        changes: a.changes,
      })),
    });
  } catch (err: any) {
    console.error('AD sync preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch AD users' }, { status: 500 });
  }
}

// POST — Execute sync
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  try {
    // Parse exclusions from request body
    let excludeEmails: Set<string> = new Set();
    try {
      const body = await req.json();
      if (body.excludeEmails && Array.isArray(body.excludeEmails)) {
        excludeEmails = new Set(body.excludeEmails.map((e: string) => e.toLowerCase()));
      }
    } catch { /* no body or invalid JSON — proceed without exclusions */ }

    const allActions = await computeSyncActions(session.user.firmId);
    // Filter out excluded users
    const actions = allActions.filter(a => {
      const email = (a.adUser.mail || a.adUser.userPrincipalName || '').toLowerCase();
      return !excludeEmails.has(email);
    });
    const firmId = session.user.firmId;
    const now = new Date();

    // Get existing display IDs for generation
    const existingDisplayIds = new Set(
      (await prisma.user.findMany({ select: { displayId: true } })).map(u => u.displayId)
    );

    const results = { created: 0, updated: 0, deactivated: 0, unchanged: 0 };

    for (const action of actions) {
      const email = (action.adUser.mail || action.adUser.userPrincipalName || '').toLowerCase();

      switch (action.action) {
        case 'create': {
          const displayId = generateDisplayId(action.adUser.displayName, existingDisplayIds);
          // Generate a random password hash — user will sign in via Microsoft
          const randomPass = crypto.randomBytes(32).toString('hex');
          const bcrypt = await import('bcryptjs');
          const hash = await bcrypt.hash(randomPass, 12);

          await prisma.user.create({
            data: {
              firmId,
              name: action.adUser.displayName,
              email,
              displayId,
              passwordHash: hash,
              entraObjectId: action.adUser.id,
              jobTitle: action.adUser.jobTitle,
              department: action.adUser.department,
              officeLocation: action.adUser.officeLocation,
              lastSyncedAt: now,
              isActive: action.adUser.accountEnabled,
            },
          });
          results.created++;
          break;
        }
        case 'update': {
          const updateData: Record<string, any> = { lastSyncedAt: now };
          if (action.changes?.name) updateData.name = action.changes.name.to;
          if (action.changes?.jobTitle) updateData.jobTitle = action.changes.jobTitle.to;
          if (action.changes?.department) updateData.department = action.changes.department.to;
          if (action.changes?.officeLocation) updateData.officeLocation = action.changes.officeLocation.to;
          if (action.changes?.entraObjectId) updateData.entraObjectId = action.changes.entraObjectId.to;
          if (action.changes?.isActive) updateData.isActive = action.changes.isActive.to === 'true';

          await prisma.user.update({
            where: { id: action.dbUserId! },
            data: updateData,
          });
          results.updated++;
          break;
        }
        case 'deactivate': {
          await prisma.user.update({
            where: { id: action.dbUserId! },
            data: { isActive: false, lastSyncedAt: now },
          });
          results.deactivated++;
          break;
        }
        case 'unchanged': {
          // Just update lastSyncedAt
          await prisma.user.update({
            where: { id: action.dbUserId! },
            data: { lastSyncedAt: now },
          });
          results.unchanged++;
          break;
        }
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('AD sync error:', err);
    return NextResponse.json({ error: err.message || 'Sync failed' }, { status: 500 });
  }
}
