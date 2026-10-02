import client from "cron/src/redis";
import { IikoDictionariesService } from "./iiko_sync.ts";

const service = new IikoDictionariesService(client);
const token = await service.authenticate(true);
await service.getCorporatinStore(token);
await service.getCorporationDepartments(token);
await service.getCorporationGroups(token);
process.exit(0);
