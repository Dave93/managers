import dayjs from "dayjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { order_items } from "@backend/../drizzle/schema";
import TokenManager from "./tokenManager";
import { DB } from "./dbconnection";
// Constants
const CHUNK_SIZE = 1000;
const DATE_FORMAT = "YYYY-MM-DD";
const API_URL = "https://les-ailes-co-co.iiko.it/resto/api";
const FILE_PATH = "./date.json";
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;


const tokenManager = TokenManager.getInstance();
let client: Client | null = null;

// Helper functions
const chunkArray = (arr: any[], size: number) =>
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
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, token, options, retries - 1);
    }
    throw error;
  }
};

// Main script
export async function main(lastDate: string, db: DB) {
  try {
    console.log('getOrderItems day', lastDate);
    console.time('fetchingOrderItems');
    const token = await tokenManager.getToken();
    const orderInfoResponse = await fetchWithRetry(
      `${API_URL}/v2/reports/olap?key=${token}`,
      token,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          reportType: "SALES",
          buildSummary: "false",
          groupByRowFields: [
            "UniqOrderId.Id", "RestorauntGroup", "OpenTime", "CloseTime",
            "Delivery.CloseTime", "OrderNum", "Delivery.Number", "ExternalNumber",
            "OrderType", "Delivery.ServiceType", "OriginName", "Delivery.SourceKey",
            "Delivery.Id", "Delivery.Email", "Delivery.IsDelivery", "Conception",
            "DayOfWeekOpen", "WeekInMonthOpen", "WeekInYearOpen", "Mounth",
            "YearOpen", "QuarterOpen", "OrderDeleted", "DeletedWithWriteoff",
            "HourOpen", "HourClose", "Delivery.PrintTime", "Delivery.BillTime",
            "PrechequeTime", "Delivery.SendTime", "Delivery.ActualTime",
            "Delivery.Phone", "Delivery.CustomerPhone", "Delivery.WayDuration",
            "OpenDate.Typed", "RestorauntGroup.Id", "RestaurantSection.Id",
            "Store.Id", "OrderType.Id", "CashRegisterName", "StoreTo",
            "CashRegisterName.Number", "SessionNum", "TableNum", "FiscalChequeNumber",
            "OrderServiceType", "Store.Name", "PayTypes.Combo", "OrderDiscount.Type",
            "Department", "PriceCategory", "JurName", "Department.Id", "DishId",
            "DishName", "DishType", "Storned"
          ],
          aggregateFields: [
            "DishDiscountSumInt", "DiscountSum", "DishAmountInt",
            "IncreasePercent", "DiscountPercent"
          ],
          filters: {
            "OpenDate.Typed": {
              filterType: "DateRange",
              periodType: "CUSTOM",
              from: lastDate,
              to: dayjs(lastDate).add(1, "day").format("YYYY-MM-DD"),
              includeLow: true,
              includeHigh: true,
            },
            "OrderDeleted": { filterType: "IncludeValues", values: ["NOT_DELETED"] },
            "DeletedWithWriteoff": { filterType: "IncludeValues", values: ["NOT_DELETED"] },
          },
        })
      }
    );

    const orderInfoData = await orderInfoResponse.json();

    console.timeEnd('fetchingOrderItems');
    try {

      let insertData = [];
      for (const report of orderInfoData.data) {
        if (report["Storned"] !== true &&
          report["DishDiscountSumInt"] > 0 &&
          (report["DishType"] == "DISH" || report["DishType"] == "MODIFIER")) {
          insertData.push({
            id: report.DishId,
            uniqOrderId: report["UniqOrderId.Id"],
            dishId: report.DishId,
            dishName: report.DishName,
            dishAmountInt: report.DishAmountInt,
            dishDiscountSumInt: report.DishDiscountSumInt,
            dishType: report.DishType,
            orderType: report.OrderType,
            orderTypeId: report["OrderType.Id"],
            openDateTyped: report["OpenDate.Typed"],
            deliveryPhone: report["Delivery.Phone"],
            restaurantGroup: report.RestorauntGroup,
            restaurantGroupId: report["RestorauntGroup.Id"],
            department: report.Department,
            departmentId: report["Department.Id"],
          });
        }
      }

      const chunkedData = chunkArray(insertData, CHUNK_SIZE);
      for (const chunk of chunkedData) {
        try {
          await db.insert(order_items)
            .values(chunk)
            .onConflictDoNothing()
            .execute();
        } catch (error) {
          console.error('Error inserting chunk:', error);
        }
      }

      console.log('Data has been inserted into the database and dates file updated');
      console.log('Total records processed:', orderInfoData.data.length);
    } finally {
    }

  } catch (error) {
    console.error('Failed to fetch data from iiko API:', error);
    await tokenManager.logout(); // Make sure to cleanup even on error
    process.exit(1);
  } finally {
  }
}
