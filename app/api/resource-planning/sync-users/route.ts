import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

/**
 * GET - Fetch users from PowerApps Dataverse and return sync preview.
 * POST - Execute sync: create missing users, return all users with resource visibility status.
 * PUT - Toggle resource visibility for a user.
 */

async function fetchDataverseUsers(firmId: string) {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { powerAppsClientId: true, powerAppsClientSecret: true, powerAppsBaseUrl: true, powerAppsTenantId: true },
  });

  if (!firm?.powerAppsClientId || !firm?.powerAppsClientSecret) {
    throw new Error('PowerApps not configured');
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${firm.powerAppsTenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: firm.powerAppsClientId,
      client_secret: firm.powerAppsClientSecret,
      scope: `${firm.powerAppsBaseUrl}/.default`,
      grant_type: 'client_credentials',
    }).toString(),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get Dataverse token');

  const url = `${firm.powerAppsBaseUrl}/api/data/v9.2/systemusers?$select=systemuserid,fullname,internalemailaddress,title,isdisabled,applicationid&$filter=isdisabled eq false and applicationid eq null&$top=500&$orderby=fullname`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
      'OData-Version': '4.0',
    },
  });

  if (!res.ok) throw new Error(`Dataverse API error: ${res.status}`);
  const data = await res.json();

  // Filter out system/service accounts
  return (data.value || [])
    .filter((u: any) => {
      const name = (u.fullname || '').toLowerCase();
      const email = (u.internalemailaddress || '').toLowerCase();
      // Exclude known service accounts
      if (name.startsWith('#') || name.startsWith('delegated')) return false;
      if (email.includes('microsoft.com') || email.includes('bittitan')) return false;
      if (!email || !name) return false;
      return true;
    })
    .map((u: any) => ({
      id: u.systemuserid,
      name: u.fullname,
      email: u.internalemailaddress,
      title: u.title || null,
    }));
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const firmId = session.user.firmId;
    const crmUsers = await fetchDataverseUsers(firmId);

    // Get existing DB users
    const dbUsers = await prisma.user.findMany({
      where: { firmId },
      select: { id: true, email: true, name: true },
    });
    const dbByEmail = new Map(dbUsers.map(u => [u.email.toLowerCase(), u]));

    // Get existing resource settings
    const resourceSettings = await prisma.resourceStaffSetting.findMany({
      where: { firmId },
      select: { userId: true },
    });
    const resourceUserIds = new Set(resourceSettings.map(r => r.userId));

    // Build user list with sync status
    const users = crmUsers.map((cu: any) => {
      const dbUser = dbByEmail.get(cu.email.toLowerCase());
      return {
        crmId: cu.id,
        name: cu.name,
        email: cu.email,
        title: cu.title,
        inDb: !!dbUser,
        dbUserId: dbUser?.id || null,
        isResourceVisible: dbUser ? resourceUserIds.has(dbUser.id) : false,
      };
    });

    return NextResponse.json({ users, total: users.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const firmId = session.user.firmId;
    const crmUsers = await fetchDataverseUsers(firmId);

    const dbUsers = await prisma.user.findMany({
      where: { firmId },
      select: { id: true, email: true },
    });
    const dbByEmail = new Map(dbUsers.map(u => [u.email.toLowerCase(), u]));

    let created = 0;
    for (const cu of crmUsers) {
      if (dbByEmail.has(cu.email.toLowerCase())) continue;

      const randomPass = require('crypto').randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(randomPass, 12);

      try {
        await prisma.user.create({
          data: {
            firmId,
            name: cu.name,
            email: cu.email,
            displayId: cu.email.split('@')[0].toUpperCase().slice(0, 6),
            passwordHash: hash,
            isFirmAdmin: false,
            jobTitle: cu.title,
          },
        });
        created++;
      } catch (err: any) {
        if (err.code !== 'P2002') console.error('User create error:', err.message);
      }
    }

    return NextResponse.json({ success: true, created, total: crmUsers.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, visible } = await req.json();
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const firmId = session.user.firmId;

  if (visible) {
    // Create ResourceStaffSetting if not exists
    const existing = await prisma.resourceStaffSetting.findUnique({ where: { userId } });
    if (!existing) {
      await prisma.resourceStaffSetting.create({
        data: {
          userId,
          firmId,
          resourceRole: 'Preparer',
          concurrentJobLimit: 5,
          weeklyCapacityHrs: 37.5,
          preparerJobLimit: 5,
          reviewerJobLimit: 0,
          riJobLimit: 0,
          specialistJobLimit: 0,
        },
      });
    }
  } else {
    // Delete ResourceStaffSetting
    await prisma.resourceStaffSetting.deleteMany({ where: { userId } });
  }

  return NextResponse.json({ success: true });
}
