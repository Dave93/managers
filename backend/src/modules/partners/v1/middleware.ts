import { ctx } from "@backend/context";
import { getCachedPartnerByAccessToken } from "@backend/modules/external_partners/utils";
import Elysia from "elysia";

export const partnersMiddleware = new Elysia({
  name: "partnersMiddleware",
})
  .use(ctx)
  .derive(async ({ redis, headers, status }) => {
    const accessToken = headers["authorization"]?.split(" ")[1];
    if (!accessToken) {
      return status(401, {
        message: "Unauthorized",
      });
    }
    const partner = await getCachedPartnerByAccessToken(redis, accessToken);
    if (!partner) {
      return status(401, {
        message: "Unauthorized",
      });
    }
    return {
      partner,
    };
  })
  .as("global");