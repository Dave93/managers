import { partnersAuthController } from "@backend/modules/partners/v1/auth/controller";
import { partnersOrganizationsController } from "@backend/modules/partners/v1/organizations/controller";
import { partnersTerminalsController } from "@backend/modules/partners/v1/terminals/controller";
import { partnersNomenclatureElementController } from "@backend/modules/partners/v1/nomenclature_element/controller";
import { partnersNomenclatureGroupController } from "@backend/modules/partners/v1/nomenclature_group/controller";
import { partnersOrdersController } from "@backend/modules/partners/v1/orders/controller";
import Elysia from "elysia";
import { ctx } from "@backend/context";
import { getCachedPartnerByAccessToken } from "@backend/modules/external_partners/utils";

export const partnersController = new Elysia({
  name: "@api/partners",
})
  .use(ctx)
  .use(partnersAuthController)
  .group("/partners/v1", (app) => app.guard({
    async beforeHandle({ redis, headers, status }) {
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
    }
  }, (app) => app
    .use(partnersOrganizationsController)
    .use(partnersTerminalsController)
    .use(partnersNomenclatureElementController)
    .use(partnersNomenclatureGroupController)
    .use(partnersOrdersController)))
