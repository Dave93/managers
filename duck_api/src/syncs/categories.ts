
import { Database } from "duckdb-async";
export const syncCategories = async (db: Database, token: string) => {


    await db.exec(`
    CREATE TABLE IF NOT EXISTS "categories" (
        "id" UUID PRIMARY KEY,
        "deleted" BOOLEAN,
        "name" TEXT
    );
    `)

    let terminalsResponse = await fetch(
        `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/products/category/list?includeDeleted=true&key=${token}`,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            }
        }
    );

    let data = await terminalsResponse.json();

    // console.log('categories', data);


    const sqlQuery = `
     ${data.map((item: any) => `INSERT INTO categories (id, name, deleted) VALUES ('${item.id}', '${item.name.replaceAll("'", "")}', '${item.deleted}') ON CONFLICT DO UPDATE SET name = '${item.name.replaceAll("'", "")}'`).join('; ')};
     `;
    await db.all(sqlQuery);
}