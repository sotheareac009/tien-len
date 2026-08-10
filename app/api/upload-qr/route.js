import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { customAlphabet } from 'nanoid';

const idGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req) {
  const form = await req.formData();
  const file = form.get('qr');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file uploaded' }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return Response.json({ error: 'Only PNG, JPG or WebP images are allowed' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'Image too large (max 5MB)' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(dir, { recursive: true });
  const filename = `${idGen()}${ext}`;
  await writeFile(path.join(dir, filename), buffer);
  return Response.json({ url: `/uploads/${filename}` });
}
