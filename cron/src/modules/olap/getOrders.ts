import TokenManager from './tokenManager';
import dayjs from "dayjs";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { orders, orders_by_time } from "@backend/../drizzle/schema";
import * as schema from "@backend/../drizzle/schema";
import { DB } from './dbconnection';
// Constants
const CHUNK_SIZE = 500;
const DATE_FORMAT = "YYYY-MM-DD";
const API_URL = "https://les-ailes-co-co.iiko.it/resto/api";
const FILE_PATH = "./date.json";
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Add token management
const tokenManager = TokenManager.getInstance();
let client: Client | null = null;
// Helper functions
const chunkArray = (arr, size) =>
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
export async function main(lastDate: string, db: DB) {
  try {
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
            "Department", "PriceCategory", "JurName", "Department.Id", "Storned", "DishType"
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
        }),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      }
    );

    const orderInfoData = await orderInfoResponse.json();

    console.timeEnd('fetchingOrders');
    let insertData = [];
    try {
      for (const report of orderInfoData.data) {
        //@ts-ignore
        if (report["Storned"] !== true && report["DishDiscountSumInt"] > 0 && (report["DishType"] == "DISH" || report["DishType"] == "MODIFIER")) {
          insertData.push({
            id: report["UniqOrderId.Id"],
            openTime: report.OpenTime,
            openDateTyped: report["OpenDate.Typed"],
            closeTime: report.CloseTime,
            deliveryActualTime: report["Delivery.ActualTime"],
            deliveryBillTime: report["Delivery.BillTime"],
            deliveryCloseTime: report["Delivery.CloseTime"],
            deliveryCustomerPhone: report["Delivery.CustomerPhone"],
            deliveryEmail: report["Delivery.Email"],
            deliveryId: report["Delivery.Id"],
            isDelivery: report["Delivery.IsDelivery"],
            deliveryNumber: report["Delivery.Number"],
            deliveryPhone: report["Delivery.Phone"],
            deliveryPrintTime: report["Delivery.PrintTime"],
            deliverySendTime: report["Delivery.SendTime"],
            deliveryServiceType: report["Delivery.ServiceType"],
            deliverySourceKey: report["Delivery.SourceKey"],
            deliveryWayDuration: report["Delivery.WayDuration"],
            conception: report.Conception,
            dayOfWeekOpen: report.DayOfWeekOpen,
            deletedWithWriteoff: report.DeletedWithWriteoff,
            department: report.Department,
            departmentId: report["Department.Id"],
            discountPercent: report.DiscountPercent,
            discountSum: report.DiscountSum,
            dishAmountInt: report.DishAmountInt,
            dishDiscountSumInt: report.DishDiscountSumInt,
            externalNumber: report.ExternalNumber,
            fiscalChequeNumber: report.FiscalChequeNumber,
            hourClose: report.HourClose,
            hourOpen: report.HourOpen,
            increasePercent: report.IncreasePercent,
            jurName: report.JurName,
            monthOpen: report.Mounth,
            orderDeleted: report.OrderDeleted,
            orderDiscountType: report["OrderDiscount.Type"],
            orderNum: report.OrderNum,
            orderServiceType: report.OrderServiceType,
            orderType: report.OrderType,
            orderTypeId: report["OrderType.Id"],
            originName: report.OriginName,
            payTypesCombo: report["PayTypes.Combo"],
            prechequeTime: report.PrechequeTime,
            priceCategory: report.PriceCategory,
            quarterOpen: report.QuarterOpen,
            restaurantSectionId: report["RestaurantSection.Id"],
            restaurantGroup: report.RestorauntGroup,
            restaurantGroupId: report["RestorauntGroup.Id"],
            sessionNum: report.SessionNum,
            storeId: report["Store.Id"],
            storeName: report["Store.Name"],
            storeTo: report.StoreTo,
            tableNum: report.TableNum,
            uniqOrderIdId: report["UniqOrderId.Id"],
            weekInMonthOpen: report.WeekInMonthOpen,
            weekInYearOpen: report.WeekInYearOpen,
            yearOpen: report.YearOpen,
            cashRegisterName: report.CashRegisterName,
            cashRegisterNumber: report["CashRegisterName.Number"]
          });
        }
      }
    } catch (error) {
      console.error('Error inserting data:', error);
      process.exit(1);
    }

    const chunkedData = chunkArray(insertData, CHUNK_SIZE);
    for (const chunk of chunkedData) {
      try {
        await db.insert(orders)
          .values(chunk)
          .onConflictDoNothing()
          .execute();

        await db.insert(orders_by_time)
          .values(chunk)
          .onConflictDoNothing()
          .execute();
      } catch (error) {
        console.error('Error inserting data:', error);
      }
    }

    console.log('Data has been inserted into the database and dates file updated');
    console.log(orderInfoData.data.length);
  } catch (error) {
    console.error('Failed to fetch data from iiko API:', error);
    await tokenManager.logout(); // Make sure to cleanup even on error
    process.exit(1);
  } finally {

  }
}