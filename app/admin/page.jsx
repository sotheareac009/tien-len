import { auth } from '@/auth';
import { isAdmin, hasAdmins } from '@/lib/admin';
import { dbEnabled, getSetting } from '@/lib/db';
import AdminPanel from '@/components/AdminPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tien Len — Operator' };

// Operator console: set the KHQR players pay into, and approve their top-ups.
// The gate is server-side — the page never renders for a non-admin.
export default async function AdminPage() {
  if (!dbEnabled()) {
    return <Denied message="Supabase is not configured." />;
  }
  if (!hasAdmins) {
    return <Denied message="No operators configured. Set ADMIN_EMAILS in .env, then restart the server." />;
  }
  const session = await auth();
  if (!session?.user?.id) {
    return <Denied message="Sign in with an operator account to open this page." />;
  }
  if (!isAdmin(session.user.email)) {
    // Name the account: the usual cause is being signed into a different
    // Google account than the one listed in ADMIN_EMAILS.
    return (
      <Denied
        message={`This page is for operators only. You are signed in as ${
          session.user.email || 'an account with no email'
        }, which is not in ADMIN_EMAILS.`}
      />
    );
  }

  const khqrUrl = await getSetting('payment_khqr_url');
  return <AdminPanel initialKhqrUrl={khqrUrl} adminName={session.user.name} />;
}

function Denied({ message }) {
  return (
    <div className="center-screen">
      <div className="panel">
        <h1 className="logo">🔒 Operator</h1>
        <p className="muted">{message}</p>
        <a className="btn" href="/">Back to the game</a>
        <a className="btn ghost" href="/api/auth/signout?callbackUrl=/admin">
          Sign in as someone else
        </a>
      </div>
    </div>
  );
}