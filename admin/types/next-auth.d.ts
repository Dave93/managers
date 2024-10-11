import NextAuth, { DefaultSession } from "next-auth";

type UserRole = {
  id: string;
  name: string;
  code: string | null;
};

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    sessionCookie?: string[];
  }

  interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    sessionCookie?: string[];
  }
}

declare module "next-auth/jwt" {
  /** Returned by the `jwt` callback and `getToken`, when using JWT sessions */
  interface JWT {
    id: string;
    name: string;
    email: string;
    exp: number;
    iat: number;
    role: UserRole;
    sessionCookie?: string[];
  }
}
