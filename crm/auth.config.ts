import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config (no database / node crypto here). The Credentials
 * provider with bcrypt lives in auth.ts which runs only in the Node runtime.
 */
export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = (user as any).id;
        token.orgId = (user as any).organizationId;
        token.role = (user as any).role;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).organizationId = token.orgId;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  providers: [], // real providers are added in auth.ts
};
