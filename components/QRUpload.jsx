'use client';

import { useRef, useState } from 'react';
import { getSocket } from '@/lib/socket-client';

// Each player uploads their own KHQR image (a photo/screenshot of their
// bank app's KHQR). Winners are paid by scanning this QR.
export default function QRUpload({ qrUrl, showToast }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('qr', file);
      const res = await fetch('/api/upload-qr', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      getSocket().emit('profile:setQR', { url: data.url });
      showToast('KHQR uploaded ✓');
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qr-upload">
      <h3>Your KHQR</h3>
      {qrUrl ? (
        <img src={qrUrl} alt="Your KHQR code" className="qr-preview" />
      ) : (
        <div className="qr-placeholder">No KHQR yet</div>
      )}
      <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : qrUrl ? 'Replace KHQR' : 'Upload KHQR'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={upload}
      />
      <p className="hint">Upload a screenshot of your bank app&apos;s KHQR so winners can be paid.</p>
    </div>
  );
}
