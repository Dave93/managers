import TokenManager from './tokenManager';
import dayjs from "dayjs";
import { productCookingTime } from "@backend/../drizzle/schema";
import db, { DB } from './dbconnection';
import { sql } from 'drizzle-orm';
// Constants
const CHUNK_SIZE = 500;
const API_URL = "https://les-ailes-co-co.iiko.it/resto/api";
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds
const FILE_PATH = "./cookingdate.json";
const fileContent = await Bun.file(FILE_PATH).text();
const datesJson = JSON.parse(fileContent);
const { dates } = datesJson;
let lastDate = dates[dates.length - 1];

// Add token management
const tokenManager = TokenManager.getInstance();
// Helper functions
const chunkArray = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

const fetchWithRetry = async (url: string, token: string, options: RequestInit, retries = MAX_RETRIES) => {
  try {
    const finalOptions = {
      ...options,
      headers: {
        ...options.headers,
        "Authorization": token
      }
    };

    const response = await fetch(url, finalOptions);

    if (response.status === 401) {
      console.log('Token is invalid, logging out');
      tokenManager.invalidateToken();
      if (retries > 0) {
        return fetchWithRetry(url, token, options, retries - 1);
      }
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    if (retries > 0) {
      console.log('Error fetching data:', error);
      console.log(`Retry attempt ${MAX_RETRIES - retries + 1}. Waiting ${RETRY_DELAY / 1000} seconds...`);
      console.log(error);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, token, options, retries - 1);
    }
    throw error;
  }
};


// Main script
const main = async (lastDate: string, db: DB) => {
  try {

    let insertData: any[] = [];
    console.time('fetchingOrders');
    const token = await tokenManager.getToken();
    const orderInfoResponse = await fetchWithRetry(
      `${API_URL}/v2/reports/olap?key=${token}`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          reportType: "SALES",
          buildSummary: "false",
          groupByRowFields: [
            "UniqOrderId.Id", "RestorauntGroup.Id", "DishName",
            "OpenTime", "Delivery.CookingFinishTime", "DishAmountInt", "DishType", "CookingPlace", "OpenDate.Typed", "Department.Id", "Department"
          ],
          aggregateFields: [
            "Cooking.GuestWaitTime.Avg"
          ],
          filters: {
            "OpenDate.Typed": {
              filterType: "DateRange",
              periodType: "CUSTOM",
              from: lastDate,
              to: dayjs(lastDate).add(1, "day").format("YYYY-MM-DD")
            },
            "OrderDeleted": { filterType: "IncludeValues", values: ["NOT_DELETED"] },
            "DeletedWithWriteoff": { filterType: "IncludeValues", values: ["NOT_DELETED"] },
          },
        }),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      }
    );

    let orderInfoData = await orderInfoResponse.json();
    // console.log('orderInfoData', orderInfoData);

    console.timeEnd('fetchingOrders');
    try {
      for (const report of orderInfoData.data) {
        if (report["UniqOrderId.Id"] == '286ac3b3-2273-46ca-90a8-dbe0a394684c') {
          console.log('report', '286ac3b3-2273-46ca-90a8-dbe0a394684c');
          console.log('report', report);
        }
        if (report["DishType"] == "DISH" || report["DishType"] == "MODIFIER") {
          // Convert date strings to Date objects and handle nulls
          const openTime = report.OpenTime ? new Date(report.OpenTime) : new Date();
          const cookingFinishTime = report["Delivery.CookingFinishTime"]
            ? new Date(report["Delivery.CookingFinishTime"])
            : null;

          // Handle decimal values by rounding to nearest integer
          const dishAmount = Number(report.DishAmountInt) || 0;
          const roundedDishAmount = Math.round(dishAmount);

          insertData.push({
            uniqOrderId: report["UniqOrderId.Id"],
            restorauntGroup: report["RestorauntGroup.Id"] || '',
            cookingPlace: report.CookingPlace || '',
            dishName: report.DishName || '',
            openTime,
            cookingFinishTime,
            dishAmountInt: roundedDishAmount,
            guestWaitTimeAvg: String(report["Cooking.GuestWaitTime.Avg"] || '0'),
            openDateTyped: report["OpenDate.Typed"] || '',
            departmentId: report["Department.Id"] || '',
            department: report["Department"] || '',
          });
        }
      }
    } catch (error) {
      console.error('Error processing data:', error);
      process.exit(1);
    }
    let orderLength = orderInfoData.data.length;
    orderInfoData = [];
    const chunkedData = chunkArray(insertData, CHUNK_SIZE);
    for (const chunk of chunkedData) {
      try {

        await db.insert(productCookingTime)
          .values(chunk)
          .onConflictDoNothing()
          .execute();
      } catch (error) {
        console.error('Error inserting chunk:', error);
        console.error('First row of problematic chunk:', chunk[0]);
        throw error;
      }
    }

    console.log('Data has been inserted into the database and dates file updated');
    console.log(orderLength);
  } catch (error) {
    console.error('Failed to fetch data from iiko API:', error);
    await tokenManager.logout(); // Make sure to cleanup even on error
    process.exit(1);
  } finally {

  }
}



while (dayjs().isAfter(dayjs(lastDate).add(1, "day"), "day")) {
  const nextDate = dayjs(lastDate).add(1, "day").format("YYYY-MM-DD");
  console.time(nextDate);

  let success = false;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Выполняем команды параллельно
      await Promise.all([
        main(nextDate, db),
      ]);

      console.timeEnd(nextDate);
      dates.push(nextDate);
      await Bun.write(FILE_PATH, JSON.stringify({ dates }, null, 2));

      const result = await Bun.file("./cookingdate.json").json();
      let newDates = result.dates;
      lastDate = newDates[newDates.length - 1];
      success = true;
      break; // Выходим из цикла попыток, если успешны
    } catch (error) {
      console.error('Error inserting data:', error);
      process.exit(1);
    }
  }
}