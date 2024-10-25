import { useSession } from "next-auth/react";

export default function useToken() {
  const { data: sessionData } = useSession();
  if (!sessionData) return null;
  //@ts-ignore
  if (typeof sessionData.accessToken !== "string") {
    return null;
  }
  //@ts-ignore
  return sessionData.accessToken;
}
