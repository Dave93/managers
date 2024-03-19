import { drizzleDb } from "@backend/lib/db";
import {
  organizationWithCredentials,
  terminalsWithCredentials,
} from "@backend/modules/cache_control/dto/cache.dto";
import { z } from "zod";
import Redis from "ioredis/built/Redis";
import { terminals, credentials } from "@backend/../drizzle/schema";
import { InferSelectModel, and, eq, inArray } from "drizzle-orm";

export class TerminalsService {
  constructor(private readonly redis: Redis) {}

  async getTerminalsFromIiko() {
    const organizations = await this.redis.get(
      `${process.env.PROJECT_PREFIX}organization`
    );

    const res = JSON.parse(
      organizations ?? "[]"
    ) as organizationWithCredentials[];

    if (res.length > 0) {
      for (const organization of res) {
        const iikoLogin = organization.credentials.find(
          (credential) => credential.type === "iiko_login"
        )?.key;
        const iikoOrganizationId = organization.credentials.find(
          (credential) => credential.type === "iiko_id"
        )?.key;

        const iikoUrl = "https://api-ru.iiko.services/api/1/";

        if (iikoLogin && iikoOrganizationId) {
          const terminalsList = await drizzleDb
            .select({
              id: terminals.id,
            })
            .from(terminals)
            .where(eq(terminals.organization_id, organization.id))
            .execute();

          let iikoTerminalIds: {
            key: string;
            model_id: string;
          }[] = [];

          const terminalIds = terminalsList.map((terminal) => terminal.id);

          if (terminalIds.length > 0) {
            const credentialsList = await drizzleDb
              .select()
              .from(credentials)
              .where(
                and(
                  eq(credentials.model, "terminals"),
                  inArray(credentials.model_id, terminalIds)
                )
              )
              .execute();

            iikoTerminalIds = credentialsList
              .filter((credential) => credential.type === "iiko_id")
              .map((credential) => ({
                key: credential.key,
                model_id: credential.model_id,
              }));
          }

          const tokenResponse = await fetch(`${iikoUrl}access_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiLogin: iikoLogin,
            }),
          });

          const tokenBody = await tokenResponse.json();
          const { token } = tokenBody;

          const terminalsResponse = await fetch(`${iikoUrl}terminal_groups`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ organizationIds: [iikoOrganizationId] }),
          });

          const terminalsBody = await terminalsResponse.json();
          //   console.log("terminalsBody", terminalsBody);

          const { terminalGroups } = terminalsBody;
          const iikoTerminals = terminalGroups[0].items;

          for (const iikoTerminal of iikoTerminals) {
            const terminalId = iikoTerminalIds.find(
              (iikoTerminalId) => iikoTerminalId.key === iikoTerminal.id
            )?.model_id;

            if (!terminalId) {
              const terminal = await drizzleDb
                .insert(terminals)
                .values({
                  name: iikoTerminal.name,
                  organization_id: organization.id,
                  latitude: 0,
                  longitude: 0,
                })
                .returning({
                  id: terminals.id,
                })
                .execute();

              await drizzleDb
                .insert(credentials)
                .values({
                  model: "terminals",
                  model_id: terminal[0].id,
                  type: "iiko_id",
                  key: iikoTerminal.id,
                })
                .execute();
            }
          }
        }
      }

      const existingTerminals = await drizzleDb.query.terminals.findMany();

      const terminalsCredentialsList = await drizzleDb
        .select()
        .from(credentials)
        .where(eq(credentials.model, "terminals"))
        .execute();

      const credentialsByTerminalId = terminalsCredentialsList.reduce(
        (acc, credential) => {
          if (!acc[credential.model_id]) {
            acc[credential.model_id] = [];
          }
          acc[credential.model_id].push(credential);
          return acc;
        },
        {} as Record<string, InferSelectModel<typeof credentials>[]>
      );

      const newTerminals: terminalsWithCredentials[] = [];

      for (const terminal of existingTerminals) {
        const credentials = credentialsByTerminalId[terminal.id];
        const newTerminal: terminalsWithCredentials = {
          ...terminal,
          credentials: [],
        };
        if (credentials) {
          newTerminal.credentials = credentials;
        }
        newTerminals.push(newTerminal);
      }

      await this.redis.set(
        `${process.env.PROJECT_PREFIX}terminals`,
        JSON.stringify(newTerminals)
      );
    }
  }
}
