import { describe, expect, it } from "bun:test";
import { loginErrorMessage } from "./auth-errors";

describe("loginErrorMessage", () => {
  it("wrong password and unknown user read the same (no user enumeration)", () => {
    expect(loginErrorMessage(401, { message: "Password is incorrect" })).toBe(
      "Invalid login or password"
    );
    expect(loginErrorMessage(401, { message: "User not found" })).toBe(
      "Invalid login or password"
    );
  });

  it("blocked user gets its own message", () => {
    expect(loginErrorMessage(401, { message: "User is blocked" })).toBe(
      "This user is blocked"
    );
  });

  it("login limit (429) is not reported as the server being down", () => {
    expect(loginErrorMessage(429, { message: "Too many login attempts" })).toBe(
      "Too many login attempts. Try again in 15 minutes."
    );
  });

  it("backend down behind the Next proxy (500) or no response at all says the server is unavailable", () => {
    const unavailable =
      "Server is unavailable. Make sure the backend and the database are running.";
    expect(loginErrorMessage(500, "Internal Server Error")).toBe(unavailable);
    expect(loginErrorMessage(502, null)).toBe(unavailable);
    expect(loginErrorMessage(undefined, undefined)).toBe(unavailable);
  });
});
