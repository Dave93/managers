export type ApiTokenRecord = { token: string; active: boolean };

export function extractBearerToken(
  authHeader: string | undefined
): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function isValidApiToken(
  tokens: ApiTokenRecord[],
  token: string
): boolean {
  return tokens.some((t) => t.active && t.token === token);
}
