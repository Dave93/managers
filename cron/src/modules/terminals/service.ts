import { DB } from "@backend/db";
import { RedisClientType } from "@backend/trpc";
import {
  OrganizationWithCredentials,
  TerminalsWithCredentials,
} from "@backend/modules/cache_control/dto/cache.dto";
import { z } from "zod";
import { Credentials } from "@backend/lib/zod";

export class TerminalsService {
  constructor(
    private readonly prisma: DB,
    private readonly redis: RedisClientType
  ) {}

  async getTerminalsFromIiko() {
    const organizations = await this.redis.get(
      `${process.env.PROJECT_PREFIX}organization`
    );

    const res: z.infer<typeof OrganizationWithCredentials>[] = JSON.parse(
      organizations ?? "[]"
    );

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
          const terminals = await this.prisma.terminals.findMany({
            where: {
              organization_id: {
                equals: organization.id,
              },
            },
          });

          const terminalIds = terminals.map((terminal) => terminal.id);

          const credentials = await this.prisma.credentials.findMany({
            where: {
              model: {
                equals: "terminals",
              },
              model_id: {
                in: terminalIds,
              },
            },
          });

          const iikoTerminalIds = credentials
            .filter((credential) => credential.type === "iiko_id")
            .map((credential) => ({
              key: credential.key,
              model_id: credential.model_id,
            }));

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
              const terminal = await this.prisma.terminals.create({
                data: {
                  name: iikoTerminal.name,
                  organization_id: organization.id,
                },
              });

              await this.prisma.credentials.create({
                data: {
                  model: "terminals",
                  model_id: terminal.id,
                  type: "iiko_id",
                  key: iikoTerminal.id,
                },
              });
            }
          }
        }
      }

      const existingTerminals = await this.prisma.terminals.findMany();

      const credentials = await this.prisma.credentials.findMany({
        where: {
          model: "terminals",
        },
      });

      const credentialsByTerminalId = credentials.reduce((acc, credential) => {
        if (!acc[credential.model_id]) {
          acc[credential.model_id] = [];
        }
        acc[credential.model_id].push(credential);
        return acc;
      }, {} as Record<string, Credentials[]>);

      const newTerminals: z.infer<typeof TerminalsWithCredentials>[] = [];

      for (const terminal of existingTerminals) {
        const credentials = credentialsByTerminalId[terminal.id];
        const newTerminal: z.infer<typeof TerminalsWithCredentials> = {
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
