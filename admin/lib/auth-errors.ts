// Turns a failed /api/users/login response into a message for the login form.
// 401 comes from the backend itself (wrong credentials / blocked user); 429 is
// the backend's login limit (too many wrong passwords for this login); any
// other status — typically 500 from the Next proxy when the backend or its
// database is down — or no response at all means the server is unreachable.
export function loginErrorMessage(
  status: number | undefined,
  body: unknown
): string {
  if (status === 401) {
    const message =
      body && typeof body === "object" && "message" in body
        ? (body as { message?: unknown }).message
        : undefined;
    return message === "User is blocked"
      ? "This user is blocked"
      : "Invalid login or password";
  }
  if (status === 429) {
    return "Too many login attempts. Try again in 15 minutes.";
  }
  return "Server is unavailable. Make sure the backend and the database are running.";
}
