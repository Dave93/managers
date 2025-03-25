import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { apiClient } from "@admin/utils/eden";
import { parse } from "cookie";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        login: { label: "Login", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.login || !credentials?.password) {
          return null;
        }

        try {
          const response = await apiClient.api.users.login.post({
            login: credentials.login,
            password: credentials.password,
          });
          console.log("response", response);
          if (!response.data) {
            return null;
          }
          const user = response.data;

          if (!("user" in user)) {
            return null;
          }
          // @ts-ignore
          let sessionCookie = response.headers.getSetCookie();
          let expires = new Date();
          for (const cookie of sessionCookie) {
            if (cookie.startsWith("sessionId=")) {
              let sessionCookie = parse(cookie);
              expires = new Date(sessionCookie.Expires);
              break;
            }
          }
          return {
            id: user.user.id,
            name: `${user.user.first_name} ${user.user.last_name}`,
            email: user.user.login,
            role: user.role,
            sessionCookie,
          };
        } catch (error) {
          console.error("Authentication error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.sessionCookie = user.sessionCookie;
      }
      return token;
    },
    async session({ session, token }) {
      session.role = token.role;
      session.sessionCookie = token.sessionCookie;
      return session;
    },
    
    
  },
  pages: {
    signIn: "/login",
  },
});


export { handler as GET, handler as POST };
