import { useSession } from "next-auth/react";

export default function useToken() {
  const { data: sessionData } = useSession();
  console.log('sessionData', sessionData)
  if (!sessionData) return null;
  //@ts-ignore
  if (typeof sessionData.sessionCookie !== "string") {
    return null;
  }
  //@ts-ignore
  return sessionData.sessionCookie;
}
