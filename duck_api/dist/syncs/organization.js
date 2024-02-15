"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncOrganizations = void 0;
const syncOrganizations = async (db, lesToken, choparToken) => {
    await db.exec(`
    CREATE TABLE IF NOT EXISTS "organization" (
        "id" UUID PRIMARY KEY,
        "name" TEXT
    );
    `);
    let terminalsResponse = await fetch(`https://api-ru.iiko.services/api/1/organizations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${lesToken}`
        },
        body: JSON.stringify({
            "organizationIds": [process.env.LESIIKO_ORG_ID]
        }),
    });
    let { organizations: lesOrganizations } = await terminalsResponse.json();
    terminalsResponse = await fetch(`https://api-ru.iiko.services/api/1/organizations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${choparToken}`
        },
        body: JSON.stringify({
            "organizationIds": [process.env.CHOPARIIKO_ORG_ID]
        }),
    });
    let { organizations: choparOrganizations } = await terminalsResponse.json();
    const sqlQuery = `
     ${lesOrganizations.map((item) => `INSERT INTO organization (id, name) VALUES ('${item.id}', '${item.name.replaceAll("'", "")}') ON CONFLICT DO UPDATE SET name = '${item.name.replaceAll("'", "")}'`).join('; ')};
        ${choparOrganizations.map((item) => `INSERT INTO organization (id, name) VALUES ('${item.id}', '${item.name.replaceAll("'", "")}') ON CONFLICT DO UPDATE SET name = '${item.name.replaceAll("'", "")}'`).join('; ')};
     `;
    await db.all(sqlQuery);
};
exports.syncOrganizations = syncOrganizations;
