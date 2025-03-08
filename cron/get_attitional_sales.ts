/**
 * Script to get additional sales data
 * 
 * Usage:
 * bun run get_attitional_sales.ts --dateFrom=2024-05-05 --dateTo=2024-05-06
 * 
 * If arguments are not provided, defaults to previous day for both dateFrom and dateTo
 */

import { parseArgs } from "util";
import { drizzleDb } from "@backend/lib/db";
import { basketAdditionalSales } from "backend/drizzle/schema";

// Function to parse command line arguments
function parseArguments(): { dateFrom: string; dateTo: string } {
    // Set default values to previous day
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Format date as YYYY-MM-DD
    const formatDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const defaultDate = formatDate(yesterday);

    // Manually parse arguments to handle potential duplicates correctly
    const args = Bun.argv;
    let dateFrom = defaultDate;
    let dateTo = defaultDate;

    for (const arg of args) {
        if (arg.startsWith('--dateFrom=')) {
            dateFrom = arg.split('=')[1];
        } else if (arg.startsWith('--dateTo=')) {
            dateTo = arg.split('=')[1];
        }
    }

    console.log('Parsed arguments:', { dateFrom, dateTo });

    return { dateFrom, dateTo };
}

/**
 * Chunks an array into smaller arrays of a specified size
 * @param array The array to be chunked
 * @param chunkSize The size of each chunk
 * @returns An array of chunks
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Main function
async function main() {
    const { dateFrom, dateTo } = parseArguments();

    console.log(`Date range: ${dateFrom} to ${dateTo}`);

    // getting lesailes additional sales
    let additionalSalesResponse = await fetch(`https://api.lesailes.uz/api/baskets/get_additional_sale?date_from=${dateFrom}&date_to=${dateTo}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MANAGERS_API_TOKEN}`
        }
    })

    let {
        data
    } = await additionalSalesResponse.json();

    // Chunk data into groups of 50 items
    const CHUNK_SIZE = 500;
    const chunkedData = chunkArray(data, CHUNK_SIZE) as any[];

    console.log(`Total items for LesAiles: ${data.length}`);
    console.log(`Number of chunks for LesAiles: ${chunkedData.length}`);

    // Process each chunk
    for (let chunk of chunkedData) {
        chunk = chunk.map((item: any) => {
            return {
                terminalId: item.terminal_id,
                organizationId: 'd955355b-c4db-3798-0163-14f6b09d000d',
                id: undefined,
                orderId: item.id,
                name: item.name,
                quantity: item.quantity,
                price: +item.total,
                operator: item.operator,
                source: item.source_type,
                createdAt: new Date(item.created_at)
            }
        })

        await drizzleDb.insert(basketAdditionalSales).values(chunk).onConflictDoUpdate({
            target: [basketAdditionalSales.id, basketAdditionalSales.createdAt],
            set: {
                organizationId: 'd955355b-c4db-3798-0163-14f6b09d000d'
            }
        });
    }


    // 664eca32-e479-4860-b1bb-56bb0cee5190
    additionalSalesResponse = await fetch(`https://api.choparpizza.uz/api/baskets/get_additional_sale?date_from=${dateFrom}&date_to=${dateTo}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CHOPAR_API_TOKEN}`
        }
    })

    const {
        data: choparData
    } = await additionalSalesResponse.json();

    // Chunk Chopar data
    const choparChunkedData = chunkArray(choparData, CHUNK_SIZE) as any[];

    console.log(`Total items for Chopar: ${choparData.length}`);
    console.log(`Number of chunks for Chopar: ${choparChunkedData.length}`);

    // Process each chunk of Chopar data
    for (let chunk of choparChunkedData) {
        chunk = chunk.map((item: any) => {
            return {
                terminalId: item.terminal_id,
                organizationId: '664eca32-e479-4860-b1bb-56bb0cee5190',
                id: undefined,
                orderId: item.id,
                name: item.name,
                quantity: item.quantity,
                price: +item.total,
                operator: item.operator,
                source: item.source_type,
                createdAt: new Date(item.created_at)
            }
        })

        await drizzleDb.insert(basketAdditionalSales).values(chunk).onConflictDoUpdate({
            target: [basketAdditionalSales.id, basketAdditionalSales.createdAt],
            set: {
                organizationId: '664eca32-e479-4860-b1bb-56bb0cee5190'
            }
        });
    }

    console.log('Additional sales data inserted successfully');
    // process.exit(0);
}

// Execute the main function
main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
