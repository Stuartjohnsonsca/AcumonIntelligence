import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Generic audio transcription endpoint.
//
// Accepts multipart/form-data with a single "file" field (audio or video
// container with audio track) and returns { text } on success. Implemented
// against Together AI's Whisper endpoint (OpenAI-compatible transcriptions
// schema) so any caller that wants speech-to-text can hit this directly.
//
// Not Risk-Forum specific — placed at /api/transcribe so it can be reused
// by any future tool that needs a transcript from a browser recording.

const TOGETHER_TRANSCRIBE_URL = 'https://api.together.xyz/v1/audio/transcriptions';
const MODEL = 'openai/whisper-large-v3';

// 25MB is the OpenAI Whisper hard limit; matching it here to avoid surprises.
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Transcription service not configured' }, { status: 500 });
  }

  try {
    const incoming = await req.formData();
    const file = incoming.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit` }, { status: 413 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }

    // Rebuild the form payload server-side in OpenAI transcriptions shape
    // so we do not forward the client's request verbatim (which may contain
    // extra fields) and so the model is explicitly pinned.
    const outbound = new FormData();
    const filename = (file instanceof File && file.name) ? file.name : 'recording.webm';
    outbound.append('file', file, filename);
    outbound.append('model', MODEL);
    outbound.append('response_format', 'json');

    const response = await fetch(TOGETHER_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: outbound,
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Transcribe upstream error:', response.status, errBody);
      return NextResponse.json(
        { error: `Transcription service returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    const text = typeof data?.text === 'string' ? data.text : '';
    if (!text) {
      return NextResponse.json({ error: 'Empty transcription result' }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Transcribe route error:', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const runtime = 'nodejs';

// Raise the body limit so 25MB audio/video files make it through.
// Next.js App Router route handlers default to unlimited when using runtime
// 'nodejs', but being explicit protects against future defaults changing.
export const dynamic = 'force-dynamic';
