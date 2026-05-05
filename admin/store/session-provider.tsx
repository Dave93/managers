"use client";
import { SessionProvider } from "next-auth/react";

// next-auth 4.x types are not compatible with React 19's stricter JSX
// component typing; the runtime behaviour is fine, so cast through any.
const SP = SessionProvider as unknown as React.ComponentType<{
  children: React.ReactNode;
}>;

export default function SessionLocalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SP>{children}</SP>;
}
