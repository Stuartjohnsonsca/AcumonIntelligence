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
  if (!session?.user?.firmId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const firmId = session.user.firmId;

    // List is driven purely by DB users flagged as Audit — mirrors Staff Setup exactly
    const dbUsers = await prisma.user.findMany({
      where: { firmId, isAuditStaff: true },
      select: {
        id: true, name: true, email: true, jobTitle: true,
        resourceStaffSetting: true,
      },
      orderBy: { name: 'asc' },
    });

    const users = dbUsers.map(u => ({
      crmId: null,
      name: u.name,
      email: u.email,
      title: u.jobTitle ?? null,
      inDb: true,
      dbUserId: u.id,
      isResourceVisible: !!u.resourceStaffSetting,
      resourceSetting: u.resourceStaffSetting ? {
        resourceRole: u.resourceStaffSetting.resourceRole,
        weeklyCapacityHrs: u.resourceStaffSetting.weeklyCapacityHrs,
        overtimeHrs: u.resourceStaffSetting.overtimeHrs,
        preparerJobLimit: u.resourceStaffSetting.preparerJobLimit,
        reviewerJobLimit: u.resourceStaffSetting.reviewerJobLimit,
        riJobLimit: u.resourceStaffSetting.riJobLimit,
        specialistJobLimit: u.resourceStaffSetting.specialistJobLimit,
      } : null,
    }));

    return NextResponse.json({ users, total: users.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.firmId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  if (!session?.user?.firmId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, visible, settings } = await req.json();
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const firmId = session.user.firmId;

  if (visible) {
    const existing = await prisma.resourceStaffSetting.findUnique({ where: { userId } });

    const data = {
      resourceRole: settings?.resourceRole || 'Preparer',
      concurrentJobLimit: settings?.preparerJobLimit || 5,
      weeklyCapacityHrs: settings?.weeklyCapacityHrs ?? 37.5,
      overtimeHrs: settings?.overtimeHrs ?? 0,
      preparerJobLimit: settings?.preparerJobLimit ?? 5,
      reviewerJobLimit: settings?.reviewerJobLimit ?? null,
      riJobLimit: settings?.riJobLimit ?? null,
      specialistJobLimit: settings?.specialistJobLimit ?? null,
      isRI: settings?.riJobLimit != null && settings.riJobLimit > 0,
    };

    if (existing) {
      await prisma.resourceStaffSetting.update({
        where: { userId },
        data,
      });
    } else {
      await prisma.resourceStaffSetting.create({
        data: { userId, firmId, ...data },
      });
    }
  } else {
    await prisma.resourceStaffSetting.deleteMany({ where: { userId } });
  }

  return NextResponse.json({ success: true });
}
