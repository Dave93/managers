
import { Database } from "duckdb-async";
export const syncProducts = async (db: Database, token: string) => {


    await db.exec(`
    CREATE TABLE IF NOT EXISTS "products" (
        "id" UUID PRIMARY KEY,
        "deleted" BOOLEAN,
        "name" STRING,
        "num" STRING,
        "category" UUID,
        "type" STRING,
    );
    `)

    let terminalsResponse = await fetch(
        `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/products/list?includeDeleted=true&key=${token}&types=DISH&types=MODIFIER`,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            }
        }
    );

    let data = await terminalsResponse.json();

    const sqlQuery = `
     ${data.map((item: any) => `INSERT INTO products 
     (id, name, deleted, num, category, type)
    VALUES ('${item.id}', '${item.name.replaceAll("'", "")}', ${item.deleted}, '${item.num}', ${item.category ? `'${item.category}'` : null}, '${item.type}') 
    ON CONFLICT
    DO UPDATE
    SET name = '${item.name.replaceAll("'", "")}', category = ${item.category ? `'${item.category}'` : null}, num = '${item.num}', deleted = ${item.deleted}`).join('; ')};
     `;
    await db.all(sqlQuery);
}