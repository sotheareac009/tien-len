import { auth } from '@/auth';
import { dbEnabled, uploadSound, setSetting, getSetting } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// Which effects the operator can replace, and the setting each is stored under.
const KINDS = {
  card: 'sound_card_url',
  chop: 'sound_chop_url',
  catch: 'sound_catch_url',
  penalty: 'sound_penalty_url',
};

const ALLOWED = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
};
const MAX_SIZE = 1024 * 1024; // 1MB — these are one-second effects

async function requireAdmin() {
  if (!dbEnabled()) return null;
  const session = await auth();
  const user = session?.user;
  return user?.id && isAdmin(user.email) ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: 'Not authorised' }, { status: 403 });
  }
  const entries = await Promise.all(
    Object.entries(KINDS).map(async ([kind, key]) => [kind, await getSetting(key)])
  );
  return Response.json({ sounds: Object.fromEntries(entries) });
}

export async function POST(req) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: 'Not authorised' }, { status: 403 });

  const form = await req.formData();
  const kind = String(form.get('kind') || '');
  const file = form.get('sound');
  if (!KINDS[kind]) return Response.json({ error: 'Unknown sound' }, { status: 400 });

  // No file, just a request to silence this one effect. Stored as the literal
  // 'off' so it is distinguishable from "no custom sound" (null).
  if (form.get('mode') === 'silence') {
    if (!(await setSetting(KINDS[kind], 'off'))) {
      return Response.json({ error: 'Could not save' }, { status: 500 });
    }
    return Response.json({ ok: true, kind, url: 'off' });
  }

  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file uploaded' }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return Response.json({ error: 'Use an MP3, OGG, WAV or WebM file' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'Sound too large (max 1MB)' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // A fixed name per kind keeps the bucket to one file each, replaced in place.
  const url = await uploadSound(`${kind}${ext}`, buffer, file.type);
  if (!url) return Response.json({ error: 'Upload failed' }, { status: 500 });
  if (!(await setSetting(KINDS[kind], url))) {
    return Response.json({ error: 'Could not save' }, { status: 500 });
  }
  return Response.json({ ok: true, kind, url });
}

// Clearing a sound falls back to the built-in synthesised effect.
export async function DELETE(req) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: 'Not authorised' }, { status: 403 });
  const kind = new URL(req.url).searchParams.get('kind');
  if (!KINDS[kind]) return Response.json({ error: 'Unknown sound' }, { status: 400 });
  if (!(await setSetting(KINDS[kind], null))) {
    return Response.json({ error: 'Could not clear' }, { status: 500 });
  }
  return Response.json({ ok: true, kind });
}
