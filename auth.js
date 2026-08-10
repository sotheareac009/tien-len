import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

// Credentials come from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET in .env.
// Sessions are stateless JWTs, which lets the Socket.IO server verify a
// player's identity straight from the session cookie (see lib/auth-socket.js).
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile, account }) {
      // Pin the identity to Google's own account id. Without an adapter
      // Auth.js generates a fresh random uuid for token.sub on every sign-in,
      // which would hand the same person a new profile — and a new empty
      // wallet — each time they log in. providerAccountId (== profile.sub) is
      // stable for the life of the Google account.
      const googleId = account?.providerAccountId || profile?.sub;
      if (googleId) {
        token.sub = String(googleId);
        // Proof that this token was minted from a Google account id rather
        // than a generated uuid. Tokens without it are not trusted anywhere.
        token.gid = String(googleId);
      }
      if (profile?.picture) token.picture = profile.picture;
      return token;
    },
    async session({ session, token }) {
      // No gid means a token from before the identity was pinned. Leaving the
      // id unset makes every wallet route treat it as signed out, so a stale
      // cookie can never mint a second profile for someone.
      if (session.user) session.user.id = token.gid ?? null;
      return session;
    },
  },
});
