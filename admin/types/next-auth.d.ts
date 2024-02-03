import NextAuth, { DefaultSession } from "next-auth";
import { InferSelectModel } from "drizzle-orm";
import { users } from "@backend/../drizzle/schema";

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session extends InferSelectModel<typeof users> {
    user: InferSelectModel<typeof users>;
    rights: string[];
    accessToken: string;
    refreshToken: string;
    role: {
      id: string;
      code: string;
    };
  }
}

declare module "next-auth/jwt" {
  /** Returned by the `jwt` callback and `getToken`, when using JWT sessions */
  interface JWT extends InferSelectModel<typeof users> {
    user: InferSelectModel<typeof users>;
    rights: string[];
    accessToken: string;
    refreshToken: string;
    role: {
      id: string;
      code: string;
    };
    exp: number;
    iat: number;
  }
}
