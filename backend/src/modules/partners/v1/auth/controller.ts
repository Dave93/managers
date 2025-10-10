import { ctx } from "@backend/context";
import { generateRefreshToken, generateToken, getCachedPartnerByEmail, getCachedPartnerByRefreshToken } from "@backend/modules/external_partners/utils";
import Elysia, { t } from "elysia";

export const partnersAuthController = new Elysia({
  name: "@api/partners/v1/auth",
  prefix: "/partners/v1/auth",
  tags: ["Partners Authentication"],
})
  .use(ctx)
  .post("/login", async ({ body: {
    email,
    password,
  }, redis, status }) => {
    const partner = await getCachedPartnerByEmail(redis, email);
    if (!partner) {
      return status(401, {
        message: "Partner not found",
      });
    }

    if (!partner.password) {
      return status(401, {
        message: "Partner has no password",
      });
    }

    if (partner.is_active == false) {
      return status(401, {
        message: "Partner is not active",
      });
    }

    const isPasswordValid = await Bun.password.verify(password, partner.password);
    if (!isPasswordValid) {
      return status(401, {
        message: "Invalid password",
      });
    }

    const accessToken = await generateToken(redis, partner, 60 * 60); // 1 hour
    const refreshToken = await generateRefreshToken(redis, partner, 60 * 60 * 3); // 3 hours
    return {
      accessToken,
      refreshToken,
    };
  }, {
    body: t.Object({
      email: t.String({
        format: "email",
        description: "Partner email address",
        examples: ["partner@example.com"]
      }),
      password: t.String({
        minLength: 6,
        description: "Partner password",
        examples: ["password123"]
      }),
    }),
    response: {
      200: t.Object({
        accessToken: t.String({
          description: "JWT access token valid for 1 hour"
        }),
        refreshToken: t.String({
          description: "JWT refresh token valid for 3 hours"
        }),
      }),
      401: t.Object({
        message: t.String({
          description: "Error message"
        }),
      }),
    },
    detail: {
      summary: "Partner Login",
      description: "Authenticate external partner with email and password. Returns access and refresh tokens upon successful authentication. Access token expires in 1 hour, refresh token expires in 3 hours.",
      tags: ["Partners Authentication"],
    },
  })
  .post("/refresh_token", async ({ body: { refreshToken }, redis, status }) => {
    const partner = await getCachedPartnerByRefreshToken(redis, refreshToken);
    if (!partner) {
      return status(401, {
        message: "Refresh token not found",
      });
    }
    if (partner.is_active == false) {
      return status(401, {
        message: "Partner is not active",
      });
    }
    const accessToken = await generateToken(redis, partner, 60 * 60); // 1 hour
    const refreshTokenNew = await generateRefreshToken(redis, partner, 60 * 60 * 3); // 3 hours
    return {
      accessToken,
      refreshToken: refreshTokenNew,
    };
  }, {
    body: t.Object({
      refreshToken: t.String({
        description: "Valid refresh token obtained from login",
        examples: ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."]
      }),
    }),
    response: {
      200: t.Object({
        accessToken: t.String({
          description: "New JWT access token valid for 1 hour"
        }),
        refreshToken: t.String({
          description: "New JWT refresh token valid for 3 hours"
        }),
      }),
      401: t.Object({
        message: t.String({
          description: "Error message"
        }),
      }),
    },
    detail: {
      summary: "Refresh Access Token",
      description: "Exchange a valid refresh token for new access and refresh tokens. Use this endpoint when the access token expires. Both old tokens will be invalidated and new ones issued.",
      tags: ["Partners Authentication"],
    },
  });