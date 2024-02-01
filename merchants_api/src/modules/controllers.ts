import { Elysia } from "elysia";
import { arrytController } from "@merchants/src/modules/arryt/controller";
import { clickController } from "./click/controller";
import { expressController } from "./express/controller";
import { iikoController } from "./iiko/controller";
import { paymeController } from "./payme/controller";
import { yandexController } from "./yandex/controller";

export const apiController = new Elysia({
    name: "@api",
    prefix: "/api",
})
    .use(arrytController)
    .use(clickController)
    .use(expressController)
    .use(iikoController)
    .use(paymeController)
    .use(yandexController)