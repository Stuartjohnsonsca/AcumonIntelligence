import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { uploadToInbox, generateSasUrl } from '@/lib/azure-blob';

/**
 * POST /api/walkthrough/upload
 * Upload a screenshot or file as evidence for a walkthrough flowchart step.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const engagementId = formData.get('engagementId') as string;
    const stepId = formData.get('stepId') as string;

    if (!file || !engagementId) {
      return NextResponse.json({ error: 'file and engagementId required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobName = `walkthrough-evidence/${engagementId}/${stepId || 'general'}/${Date.now()}_${safeName}`;

    await uploadToInbox(blobName, buffer, file.type || 'image/png');
    const url = generateSasUrl(blobName, 'upload-inbox', 60);

    return NextResponse.json({
      id: `ev_${Date.now()}`,
      name: file.name,
      storagePath: blobName,
      url,
    });
  } catch (error: any) {
    console.error('Walkthrough evidence upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
