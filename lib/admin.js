// Operators are listed by email in ADMIN_EMAILS (comma-separated). They are
// the only accounts that can set the payment KHQR and approve top-ups.
const admins = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(email) {
  return !!email && admins.includes(String(email).toLowerCase());
}

export const hasAdmins = admins.length > 0;
