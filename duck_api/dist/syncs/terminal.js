"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncTerminal = void 0;
const syncTerminal = async (db, lesToken, choparToken) => {
    await db.exec(`
    CREATE TABLE IF NOT EXISTS "terminal" (
        "id" UUID PRIMARY KEY,
        "name" TEXT,
        "organizationId" UUID,
    );
    `);
    let terminalsResponse = await fetch(`https://api-ru.iiko.services/api/1/terminal_groups`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${lesToken}`
        },
        body: JSON.stringify({
            "organizationIds": [process.env.LESIIKO_ORG_ID]
        }),
    });
    let { terminalGroups } = await terminalsResponse.json();
    const lesItems = terminalGroups[0].items;
    terminalsResponse = await fetch(`https://api-ru.iiko.services/api/1/terminal_groups`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${choparToken}`
        },
        body: JSON.stringify({
            "organizationIds": [process.env.CHOPARIIKO_ORG_ID]
        }),
    });
    terminalGroups = (await terminalsResponse.json()).terminalGroups;
    const choparItems = terminalGroups[0].items;
    const sqlQuery = `
     ${lesItems.map((item) => `INSERT INTO terminal (id, name, organizationId) VALUES ('${item.id}', '${item.name.replaceAll("'", "")}', '${process.env.LESIIKO_ORG_ID}') ON CONFLICT DO UPDATE SET name = '${item.name.replaceAll("'", "")}'`).join('; ')};
        ${choparItems.map((item) => `INSERT INTO terminal (id, name, organizationId) VALUES ('${item.id}', '${item.name.replaceAll("'", "")}', '${process.env.CHOPARIIKO_ORG_ID}') ON CONFLICT DO UPDATE SET name = '${item.name.replaceAll("'", "")}'`).join('; ')};
     `;
    await db.all(sqlQuery);
};
exports.syncTerminal = syncTerminal;
