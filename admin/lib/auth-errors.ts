// Turns a failed /api/users/login response into a message for the login form.
// 401 comes from the backend itself (wrong credentials / blocked user); any
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
  return "Server is unavailable. Make sure the backend and the database are running.";
}
