import { ctx } from "@backend/context";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const stopListController = new Elysia({
    name: '@api/stoplist'
})
    .use(ctx)
    .get('/stoplist/list', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('stoplist.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        let selectFields: SelectedFields = {};

        const duckResponse = await fetch('http://127.0.0.1:9999/stoplist/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                limit: +limit,
                offset: +offset,
                filter: filters ? JSON.parse(filters) : [],
            })
        });

        const data = await duckResponse.json();


        return {
            total: data.total,
            data: data.data
        };
    }, {
        query: t.Object({
            limit: t.String(),
            offset: t.String(),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })
    .post('/stoplist/webhook', async ({

        // @ts-ignore
        bearer,
        set, drizzle, cacheController
    }) => {
        console.log('bearer', bearer)

        if (!bearer) {
            set.status = 401;
            return {
                message: 'Token not found'
            };
        }

        const apiTokens = await cacheController.getCachedApiTokens({});

        const token = apiTokens.find((item: any) => item.token === bearer);

        if (!token) {
            set.status = 401;
            return {
                message: 'Token not found'
            };
        }

        if (!token.active) {
            set.status = 401;
            return {
                message: 'Token not active'
            };
        }

        const organization = await token.organization;

        const organizationCredentials = await cacheController.getCachedCredentials({});

        const credentials = organizationCredentials.filter((item: any) => item.model_id === organization.id && item.model == 'organization');


        const iikoId = credentials.find((item: any) => item.type === 'iiko_id')?.key;

        const iikoLogin = credentials.find((item: any) => item.type === 'iiko_login')?.key;

        if (!iikoId || !iikoLogin) {
            set.status = 401;
            return {
                message: 'Credentials not found'
            };
        }


        let response = await fetch(
            `https://api-ru.iiko.services/api/1/access_token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    "apiLogin": iikoLogin
                }),
            }
        );

        let body = await response.json();

        const transportToken = body.token;

        response = await fetch(
            `https://api-ru.iiko.services/api/1/stop_lists`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${transportToken}`
                },
                body: JSON.stringify({
                    "organizationIds": [iikoId]
                }),
            }
        );

        const stopListData = await response.json();


        const items = stopListData.terminalGroupStopLists[0].items;

        const actualItems: {
            terminalId: string,
            productId: string,
            dateAdd: boolean
        }[] = [];

        for (let terminal of items) {
            for (let item of terminal.items) {
                actualItems.push({
                    terminalId: terminal.terminalGroupId,
                    productId: item.productId,
                    dateAdd: item.dateAdd
                });
            }
        }


        // console.log('actualItems', actualItems);

        const data = await fetch('http://127.0.0.1:9999/stoplist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                stops: actualItems
            })
        });

        const result = await data.json();

        console.log('result', result);
    })