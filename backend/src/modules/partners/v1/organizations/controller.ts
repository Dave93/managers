import Elysia, { t } from "elysia";
import { partnersMiddleware } from "../middleware";
import { organization } from "backend/drizzle/schema";
import { ctx } from "@backend/context";

export const partnersOrganizationsController = new Elysia({
  name: "@api/partners/v1/organizations",
  tags: ["Partners Organizations"],
})
  .use(ctx)
  .get("/organizations", async ({ drizzle }) => {
    const organizations = await drizzle.select().from(organization).execute();
    return {
        data: organizations.map(org => ({
          id: org.id,
          name: org.name,
          active: org.active,
          phone: org.phone,
          description: org.description,
          iconUrl: org.icon_url,
          code: org.code,
          createdAt: org.created_at,
          updatedAt: org.updated_at,
          createdBy: org.created_by,
          updatedBy: org.updated_by,
        })),
    };
  }, {
    response: {
      200: t.Object({
        data: t.Array(
          t.Object({
            id: t.String({
              format: "uuid",
              description: "Organization unique identifier"
            }),
            name: t.String({
              description: "Organization name"
            }),
            active: t.Boolean({
              description: "Whether the organization is active"
            }),
            phone: t.Nullable(t.String({
              description: "Organization phone number"
            })),
            description: t.Nullable(t.String({
              description: "Organization description"
            })),
            iconUrl: t.Nullable(t.String({
              description: "URL to organization icon/logo"
            })),
            code: t.Nullable(t.String({
              description: "Organization code"
            })),
            createdAt: t.String({
              format: "date-time",
              description: "Organization creation timestamp"
            }),
            updatedAt: t.String({
              format: "date-time",
              description: "Organization last update timestamp"
            }),
            createdBy: t.Nullable(t.String({
              format: "uuid",
              description: "ID of user who created the organization"
            })),
            updatedBy: t.Nullable(t.String({
              format: "uuid",
              description: "ID of user who last updated the organization"
            })),
          })
        ),
      }),
    },
    detail: {
      summary: "Get All Organizations",
      description: "Retrieve a complete list of all organizations in the system. This endpoint returns all organization records with their full details including name, contact information, and metadata. Requires partner authentication.",
      tags: ["Partners Organizations"],
    },
  });