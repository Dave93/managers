import { drizzleDb } from "@backend/lib/db";
import {
  discount_type,
  measure_unit,
  order_type,
  payment_type,
  tax_category,
  conception,
  accounting_category,
  nomenclature_category,
  nomenclature_group,
  nomenclature_element,
  invoices,
  invoice_items,
  internal_transfer,
  internal_transfer_items,
  corporation_store,
  writeoff,
  writeoff_items,
  report_olap,
  corporation_terminals,
  corporation_department,
  corporation_groups,
  balance_store,
  suppliers,
} from "backend/drizzle/schema";
import path from "path";
const fs = require("fs");
const xml2js = require("xml2js");

import { Redis } from "ioredis";
import { SQL, eq } from "drizzle-orm";
import { mapCompactResponse, t } from "elysia";
import dayjs from "dayjs";
import client from "cron/src/redis";
import { CacheControlService } from "@backend/modules/cache_control/service";

const cacheControlService = new CacheControlService(drizzleDb, client);

export class IikoDictionariesService {
  constructor(private readonly redis: Redis) {}

  async getIikoDictionariesFromIiko() {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`,
      {
        method: "GET",
      }
    );

    const token = await response.text();

    // console.log("token", token);

    await this.getTaxCategories(token);
    await this.getPaymentTypes(token);
    await this.getOrderTypes(token);
    await this.getMeasureUnit(token);
    await this.getDiscountTypes(token);
    await this.getConceptions(token);
    await this.getAccountingCategorys(token);
    await this.getNomenclatureGroups(token);
    await this.getNomenclatureCatergorys(token);
    await this.getNomenclatureElements(token);
    await this.getIncomingInvoice(token);
    await this.getOutgoingInvoice(token);
    await this.getInternalTransfer(token);
    await this.getWriteOff(token);
    await this.getCorporatinStore(token);
    await this.getCorporationDepartments(token);
    await this.getCorporationGroups(token);
    await this.getBalanceStores(token);
    await this.getReportOlap(token);
    await this.getSupplers(token);
  }

  checkForNullString = (value: string) => {
    if (value === "" || value.toLowerCase() === "null") {
      // Учитывая пустую строку и "null" (не чувствительно к регистру)
      return null;
    } else if (value.toLowerCase() === "false") {
      // Преобразование строки "false" в логическое значение
      return false;
    } else if (value.toLowerCase() === "true") {
      // Преобразование строки "true" в логическое значение
      return true;
    } else {
      return value;
    }
  };

  parseInteger = (value) => {
    const intValue = parseFloat(value);
    return isNaN(intValue) ? null : intValue;
  };

  async getBalanceStores(token: string) {
    const date = dayjs()
      .startOf("month")
      .add(5, "hour")
      .format("YYYY-MM-DDTHH:mm:ss");

    const storeId = await drizzleDb
      .select({ id: corporation_store.id })
      .from(corporation_store);

    for (const store of storeId) {
      const response = await fetch(
        `https://les-ailes-co-co.iiko.it/resto/api/v2/reports/balance/stores?key=${token}&timestamp=${date}&store=${store.id}`,
        {
          method: "GET",
        }
      );
      // console.log("response", response);
      const storeResponce = await response.json();

      const existingBalanceStores = await drizzleDb
        .select()
        .from(balance_store)
        .execute();

      for (const balanceStore of storeResponce) {
        const existingBalanceStore = existingBalanceStores.find(
          (existingBalanceStore) => existingBalanceStore.id === balanceStore.id
        );
        console.log("started BalanceStore db inserting");
        console.time("BalanceStore_db_inserting");
        if (!existingBalanceStore) {
          try {
            await drizzleDb
              .insert(balance_store)
              .values({
                id: balanceStore.id,
                storeId: balanceStore.store,
                productId: balanceStore.product,
                amount: balanceStore.amount,
                sum: balanceStore.sum,
                enddate: date,
              })
              .execute();
          } catch (e) {
            console.log(e);
          }
        } else {
          try {
            await drizzleDb
              .update(balance_store)
              .set({
                storeId: balanceStore.store,
                productId: balanceStore.product,
                amount: balanceStore.amount,
                sum: balanceStore.sum,
                enddate: date,
              })
              .where(eq(balance_store.id, balanceStore.id))
              .execute();
          } catch (e) {
            console.log(e);
          }
        }
        console.timeEnd("BalanceStore_db_inserting");
        console.log("finished BalanceStore db inserting");
      }
    }
  }

  async getCorporationDepartments(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/corporation/departments?includeDeleted=true&key=${token}`,
      {
        method: "GET",
      }
    );
    // console.log("response", response);
    const corporation = await response.text();
    // console.log("corporation", corporation);

    const corporation_departments = await drizzleDb
      .select()
      .from(corporation_department)
      .execute();

    xml2js.parseString(corporation, async (err, result) => {
      if (err) {
        throw err;
      }

      // console.log("result", result);
      for (const corporation_departmentTable of result.corporateItemDtoes
        .corporateItemDto) {
        // console.log("corporation_departmentTable", corporation_departmentTable);
        let departmentItem = {
          id:
            corporation_departmentTable.id && corporation_departmentTable.id[0]
              ? this.checkForNullString(corporation_departmentTable.id[0])
              : "",
          parentId:
            corporation_departmentTable.parentId &&
            corporation_departmentTable.parentId[0]
              ? this.checkForNullString(corporation_departmentTable.parentId[0])
              : "",
          name:
            corporation_departmentTable.name &&
            corporation_departmentTable.name[0]
              ? this.checkForNullString(corporation_departmentTable.name[0])
              : "",
          type:
            corporation_departmentTable.type &&
            corporation_departmentTable.type[0]
              ? this.checkForNullString(corporation_departmentTable.type[0])
              : "",
        };
        const existingCorporates = corporation_departments.find(
          (existingCorporates) => existingCorporates.id === departmentItem.id
        );
        console.log("started Departments db inserting");
        console.time("Departments_db_inserting");
        if (!existingCorporates) {
          await drizzleDb
            .insert(corporation_department)
            .values({
              id: departmentItem.id!.toString(),
              parentId: departmentItem.parentId!.toString(),
              name: departmentItem.name!.toString(),
              type: departmentItem.type!.toString(),
            })
            .execute();
        } else {
          await drizzleDb
            .update(corporation_department)
            .set({
              parentId: departmentItem.parentId?.toString(),
              name: departmentItem.name?.toString(),
              type: departmentItem.type?.toString(),
            })
            .where(eq(corporation_department.id, departmentItem.id!.toString()))
            .execute();
        }
        console.timeEnd("Departments_db_inserting");
        console.log("finished Departments db inserting");
      }
    });
  }

  async getCorporationGroups(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/corporation/groups?key=${token}`,
      {
        method: "GET",
      }
    );
    // console.log("response", response);
    const corporationGroups = await response.text();
    // console.log("corporationGroups", corporationGroups);

    const existingCorporationGroups = await drizzleDb
      .select()
      .from(corporation_groups)
      .execute();

    xml2js.parseString(corporationGroups, async (err, result) => {
      if (err) {
        throw err;
      }

      // console.log("result", result);
      for (const corporation_groupTable of result.groupDtoes.groupDto) {
        // console.log("corporation_groupTable", corporation_groupTable);
        let groupItem = {
          id:
            corporation_groupTable.id && corporation_groupTable.id[0]
              ? this.checkForNullString(corporation_groupTable.id[0])
              : "",
          name:
            corporation_groupTable.name && corporation_groupTable.name[0]
              ? this.checkForNullString(corporation_groupTable.name[0])
              : "",
          departmentId:
            corporation_groupTable.departmentId &&
            corporation_groupTable.departmentId[0]
              ? this.checkForNullString(corporation_groupTable.departmentId[0])
              : "",
          groupServiceMode:
            corporation_groupTable.groupServiceMode &&
            corporation_groupTable.groupServiceMode[0]
              ? this.checkForNullString(
                  corporation_groupTable.groupServiceMode[0]
                )
              : "",
        };
        const existingCorporates = existingCorporationGroups.find(
          (existingCorporates) => existingCorporates.id === groupItem.id
        );
        console.log("started Cor_groups db inserting");
        console.time("Cor_groups_db_inserting");
        if (!existingCorporates) {
          await drizzleDb
            .insert(corporation_groups)
            .values({
              id: groupItem.id!.toString(),
              name: groupItem.name!.toString(),
              departmentId: groupItem.departmentId!.toString(),
              groupServiceMode: groupItem.groupServiceMode!.toString(),
            })
            .execute();
        } else {
          await drizzleDb
            .update(corporation_groups)
            .set({
              name: groupItem.name?.toString(),
              departmentId: groupItem.departmentId?.toString(),
              groupServiceMode: groupItem.groupServiceMode?.toString(),
            })
            .where(eq(corporation_groups.id, groupItem.id!.toString()))
            .execute();
        }
        console.timeEnd("Cor_groups_db_inserting");
        console.log("finished Cor_groups db inserting");
      }
    });
  }

  async getReportOlap(token: string) {
    const fromDate = dayjs()
      .startOf("month")
      .subtract(7, 'day')
      .add(5, "hour")
      .format("YYYY-MM-DD");
    const toDate = dayjs()
    .subtract(7, 'day')
    .add(5, "hour")
    .format("YYYY-MM-DD");
    // console.log("fromDate", fromDate);
    // console.log("toDate", toDate);
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/reports/olap?key=${token}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reportType: "TRANSACTIONS",
          buildSummary: "true",
          groupByRowFields: [],
          groupByColFields: [
            "DateTime.DateTyped",
            "Session.Group",
            "TransactionType",
            "Product.Type",
            "Product.Name",
            "Product.Id",
          ],
          aggregateFields: ["Amount.Out"],
          filters: {
            "DateTime.DateTyped": {
              filterType: "DateRange",
              from: fromDate,
              to: toDate,
              includeLow: true,
              includeHigh: true,
            },
            TransactionType: {
              filterType: "IncludeValues",
              values: ["SESSION_WRITEOFF"],
            },
            "Product.Type": {
              filterType: "IncludeValues",
              values: ["PREPARED", "GOODS"],
            },
          },
        }),
      }
    );
    // console.log("response", response);
    
    const reportOlap = await response.json();
    
    // console.log("reportOlap", reportOlap);
    
    const existingReportOlap = await drizzleDb
      .select()
      .from(report_olap)
      .execute();
    
      console.log("started report olap db inserting");
      console.time("report_olap_db_inserting");
    
    // console.log("reportOlap", reportOlap);

    for (const reportOlaps of reportOlap.data) {
      const existingReportOlapItem = existingReportOlap.find(
        (existingReportOlapItem) => existingReportOlapItem.id === reportOlaps.id
      );
      // console.log("existingReportOlapItem", existingReportOlapItem);
      try {
        if (!existingReportOlapItem) {
          // console.log("reportOlaps", reportOlaps);
          await drizzleDb
            .insert(report_olap)
            .values({
              id: reportOlaps.id,
              dateTime: reportOlaps["DateTime.DateTyped"],
              productId: reportOlaps["Product.Id"],
              productName: reportOlaps["Product.Name"],
              productType: reportOlaps["Product.Type"],
              sessionGroup: reportOlaps["Session.Group"],
              transactionType: reportOlaps["TransactionType"],
              amauntOut: reportOlaps["Amount.Out"],
            })
            .execute();
        } else {
          // console.log("reportOlaps", reportOlaps);
          await drizzleDb
            .update(report_olap)
            .set({
              dateTime: reportOlaps["DateTime.DateTyped"],
              productId: reportOlaps["Product.Id"],
              productName: reportOlaps["Product.Name"],
              productType: reportOlaps["Product.Type"],
              sessionGroup: reportOlaps["Session.Group"],
              transactionType: reportOlaps["TransactionType"],
              amauntOut: reportOlaps["Amount.Out"],
            })
            .where(eq(report_olap.id, reportOlaps.id))
            .execute();
        }
      } catch (error) {
        console.error("Error:", error);
      }
    }
    console.timeEnd("report_olap_db_inserting");
    console.log("Finished report olap db inserting");
  }

  async getWriteOff(token: string) {
    const fromDate = dayjs().subtract(40, "day").format("YYYY-MM-DD");
    const toDate = dayjs().format("YYYY-MM-DD");
    // console.log("token", token);
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/documents/writeoff?key=${token}&dateFrom=${fromDate}&dateTo=${toDate}`,
      {
        method: "GET",
      }
    );

    // console.log("davr");

    const writeoffs = await response.json();
    // console.log("writeoffs", writeoffs);

    const existingWriteOffs = await drizzleDb.select().from(writeoff).execute();

    console.log("started writeoff db inserting");
    console.time("writeoff_db_inserting");

    // console.log("existingWriteOffs", existingWriteOffs);

    for (const write_off of writeoffs.response) {
      const existingWriteOff = existingWriteOffs.find(
        (existingWriteOff) => existingWriteOff.id === write_off.id
      );
      // console.log("existingWriteOff", existingWriteOff);

      // console.log("write_off", write_off);

      if (!existingWriteOff) {
        try {
          // console.log("write_off", write_off);
          await drizzleDb
            .insert(writeoff)
            .values({
              id: write_off.id,
              dateIncoming: write_off.dateIncoming,
              documentNumber: write_off.documentNumber,
              status: write_off.status,
              conceptionId: write_off.conceptionId,
              comment: write_off.comment,
              storeId: write_off.storeId,
            })
            .execute();
        } catch (e) {
          console.log(e);
        }
        for (const item of write_off.items) {
          try {
            await drizzleDb
              .insert(writeoff_items)
              .values({
                id: item.id,
                productId: item.productId,
                productSizeId: item.productSizeId,
                amountFactor: this.parseInteger(item.amountFactor),
                amount: item.amount,
                measureUnitId: item.measureUnitId,
                containerId: item.containerId,
                cost: this.parseInteger(item.cost),
                writeoff_id: write_off.id!.toString() || null,
                writeoffincomingdate: write_off.dateIncoming,
              })
              .execute();
          } catch (e) {
            console.log(e);
          }
        }
      } else {
        try {
          // console.log("write_off", write_off);
          await drizzleDb

            .update(writeoff)
            .set({
              dateIncoming: write_off.dateIncoming,
              documentNumber: write_off.documentNumber,
              status: write_off.status,
              conceptionId: write_off.conceptionId,
              comment: write_off.comment,
              storeId: write_off.storeId,
            })
            .where(eq(writeoff.id, write_off.id))
            .execute();

          await drizzleDb
            .delete(writeoff_items)
            .where(eq(writeoff_items.writeoff_id, write_off.id!.toString()))
            .execute();

          for (const item of write_off.items) {
            // console.log("item", item);
            await drizzleDb
              .insert(writeoff_items)
              .values({
                id: item.id,
                productId: item.productId,
                productSizeId: item.productSizeId,
                amountFactor: this.parseInteger(item.amountFactor),
                amount: item.amount,
                measureUnitId: item.measureUnitId,
                containerId: item.containerId,
                cost: this.parseInteger(item.cost),
                writeoff_id: write_off.id!.toString() || null,
                writeoffincomingdate: write_off.dateIncoming,
              })
              // .where(eq(writeoff_items.writeoff_id, write_off.id!.toString()))
              .execute();
          }
        } catch (e) {
          console.log(e);
        }
      }

      console.timeEnd("writeoff_db_inserting");
      console.log("finished writeoff db inserting");
    }
  }

  async getCorporatinStore(token: string) {
    try {
      const response = await fetch(
        `https://les-ailes-co-co.iiko.it/resto/api/corporation/stores?key=${token}`,
        {
          method: "GET",
        }
      );

      let corporation = await response.text();
      // console.log(corporation);

      const corpStoreTable = await drizzleDb
        .select()
        .from(corporation_store)
        .execute();

      xml2js.parseString(corporation, async (err, result) => {
        if (err) {
          throw err;
        }

        // console.log(
        //   "stores count",
        //   result.corporateItemDtoes.corporateItemDto.length
        // );
        // console.log("dda", result.corporateItemDtoes.corporateItemDto);
        // console.log("existing data", corpStoreTable);
        console.log("started Cor_stores db inserting");
        console.time("Cor_stores_db_inserting");
        for (const corpStoreTables of result.corporateItemDtoes
          .corporateItemDto) {
          let storeItem = {
            id:
              corpStoreTables.id && corpStoreTables.id[0]
                ? this.checkForNullString(corpStoreTables.id[0])
                : "",
            parentId:
              corpStoreTables.parentId && corpStoreTables.parentId[0]
                ? this.checkForNullString(corpStoreTables.parentId[0])
                : "",
            code:
              corpStoreTables.code && corpStoreTables.code[0]
                ? this.checkForNullString(corpStoreTables.code[0])
                : "",
            name:
              corpStoreTables.name && corpStoreTables.name[0]
                ? this.checkForNullString(corpStoreTables.name[0])
                : "",
            type:
              corpStoreTables.type && corpStoreTables.type[0]
                ? this.checkForNullString(corpStoreTables.type[0])
                : "",
          };
          const existingCorporates = corpStoreTable.find(
            (existingCorporates) => existingCorporates.id === storeItem.id
          );

          if (!existingCorporates) {
            await drizzleDb
              .insert(corporation_store)
              .values({
                id: storeItem.id!.toString(),
                parentId: storeItem.parentId,
                code: storeItem.code,
                name: storeItem.name,
                type: storeItem.type,
              })
              .execute();
          } else {
            await drizzleDb
              .update(corporation_store)
              .set({
                parentId: storeItem.parentId?.toString(),
                code: storeItem.code?.toString(),
                name: storeItem.name?.toString(),
                type: storeItem.type?.toString(),
              })
              .where(eq(corporation_store.id, storeItem.id!.toString()))
              .execute();
          }
        }

        await cacheControlService.cacheStores();
      });
    } catch (error) {
      console.error("Error:", error);
    }
    console.timeEnd("Cor_stores_db_inserting");
    console.log("finished Cor_stores db inserting");
  }

  async getInternalTransfer(token: string) {
    const fromDate = dayjs().subtract(40, "day").format("YYYY-MM-DD");
    const toDate = dayjs().format("YYYY-MM-DD");
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/documents/internalTransfer?key=${token}&dateFrom=${fromDate}&dateTo=${toDate}`,
      {
        method: "GET",
      }
    );
    // console.log("response", response);
    // console.log("body", await response.json());
    const internalTransfers = await response.json();
    // console.log("internalTransfers before", internalTransfers.response);

    const existingInternalTransfers = await drizzleDb
      .select()
      .from(internal_transfer)
      .execute();

    console.log("started Transfers db inserting");
    console.time("Transfers_db_inserting");

    // console.log("internalTransfers after", internalTransfers);
    for (const internalTransfer of internalTransfers.response) {
      // console.log("internalTransfer", internalTransfer);
      const existingInternalTransfer = existingInternalTransfers.find(
        (existingInternalTransfer) =>
          existingInternalTransfer.id === internalTransfer.id
      );

      if (!existingInternalTransfer) {
        try {
          await drizzleDb
            .insert(internal_transfer)
            .values({
              id: internalTransfer.id,
              dateIncoming: internalTransfer.dateIncoming,
              documentNumber: internalTransfer.documentNumber,
              status: internalTransfer.status,
              conceptionId: internalTransfer.conceptionId,
              storeFromId: internalTransfer.storeFromId,
              storeToId: internalTransfer.storeToId,
            })
            .execute();
        } catch (e) {
          console.log(e);
        }
        for (const item of internalTransfer.items) {
          try {
            await drizzleDb
              .insert(internal_transfer_items)
              .values({
                id: item.id,
                productId: item.productId,
                amount: this.parseInteger(item.amount),
                measureUnitId: item.measureUnitId,
                containerId: item.containerId,
                cost: this.parseInteger(item.cost),
                internal_transfer_id: internalTransfer.id!.toString() || null,
                num: item.num,
                internaltransferdate: internalTransfer.dateIncoming,
              })
              .execute();
          } catch (e) {
            console.log(e);
          }
        }
      } else {
        try {
          await drizzleDb

            .update(internal_transfer)
            .set({
              dateIncoming: internalTransfer.dateIncoming,
              documentNumber: internalTransfer.documentNumber,
              status: internalTransfer.status,
              conceptionId: internalTransfer.conceptionId,
              storeFromId: internalTransfer.storeFromId,
              storeToId: internalTransfer.storeToId,
            })
            .where(eq(internal_transfer.id, internalTransfer.id))
            .execute();
        } catch (e) {
          console.log(e);
        }

        // console.log("internalTransfer", internalTransfer.items[0]);
        try {
          await drizzleDb
            .delete(internal_transfer_items)
            .where(
              eq(
                internal_transfer_items.internal_transfer_id,
                internalTransfer.id
              )
            )
            .execute();
        } catch (e) {
          console.log(e);
        }
        for (const item of internalTransfer.items) {
          try {
            await drizzleDb
              .insert(internal_transfer_items)
              .values({
                id: item.id,
                productId: item.productId,
                amount: this.parseInteger(item.amount),
                measureUnitId: item.measureUnitId,
                containerId: item.containerId,
                cost: this.parseInteger(item.cost),
                internal_transfer_id: internalTransfer.id!.toString() || null,
                num: item.num,
                internaltransferdate: internalTransfer.dateIncoming,
              })
              .execute();
          } catch (e) {
            console.log(e);
          }
        }
      }
    }

    console.timeEnd("Transfers_db_inserting");
    console.log("finished Transfers db inserting");
  }

  async getOutgoingInvoice(token: string, type: string = "outgoing") {
    const fromDate = dayjs().subtract(50, "day").format("YYYY-MM-DD");
    const toDate = dayjs().format("YYYY-MM-DD");
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/documents/export/${type}Invoice?key=${token}&from=${fromDate}&to=${toDate}&includeDeleted=false`,
      {
        method: "GET",
      }
    );

    const receiptInvoice = await response.text();

    let incomeDoc = [];
    const incomeDocs = await drizzleDb.select().from(invoices).execute();
    xml2js.parseString(receiptInvoice, async (err, result) => {
      if (err) {
        throw err;
      }

      console.log("started outgoing db inserting");
      console.time("outgoing_db_inserting");

      const docs = result[`${type}InvoiceDtoes`].document;

      for (const record of docs) {
        // console.log("record", record);
        const incomeDoc = {
          id:
            record.id && record.id[0]
              ? (this.checkForNullString(record.id[0]) as string)
              : "",
          documentNumber:
            record.documentNumber && record.documentNumber[0]
              ? this.checkForNullString(record.documentNumber[0])
              : "",
          incomingDate:
            record.dateIncoming && record.dateIncoming[0]
              ? this.checkForNullString(record.dateIncoming[0])
              : "",
          useDefaultDocumentTime:
            record.useDefaultDocumentTime && record.useDefaultDocumentTime[0]
              ? this.checkForNullString(record.useDefaultDocumentTime[0])
              : "",
          status:
            record.status && record.status[0]
              ? this.checkForNullString(record.status[0])
              : "",
          accountToCode:
            record.accountToCode && record.accountToCode[0]
              ? this.checkForNullString(record.accountToCode[0])
              : "",
          revenueAccountCode:
            record.revenueAccountCode && record.revenueAccountCode[0]
              ? this.checkForNullString(record.revenueAccountCode[0])
              : "",
          defaultStore:
            record.defaultStoreId && record.defaultStoreId[0]
              ? this.checkForNullString(record.defaultStoreId[0])
              : "",
          defaultStoreCode:
            record.defaultStoreCode && record.defaultStoreCode[0]
              ? this.checkForNullString(record.defaultStoreCode[0])
              : "",
          supplier:
            record.counteragentId && record.counteragentId[0]
              ? this.checkForNullString(record.counteragentId[0])
              : "",
          counteragentCode:
            record.counteragentCode && record.counteragentCode[0]
              ? this.checkForNullString(record.counteragentCode[0])
              : "",
          linkedIncomingInvoiceId:
            record.linkedIncomingInvoiceId && record.linkedIncomingInvoiceId[0]
              ? this.checkForNullString(record.linkedIncomingInvoiceId[0])
              : "",
        };
        // console.log("incomeDoc", incomeDoc);
        const existingIncomeDoc = incomeDocs.find(
          (existingIncomeDoc) => existingIncomeDoc.id === incomeDoc.id
        );

        if (!existingIncomeDoc) {
          try {
            await drizzleDb
              .insert(invoices)
              .values({
                id: incomeDoc.id,
                documentNumber: incomeDoc.documentNumber,
                incomingDate: incomeDoc.incomingDate,
                useDefaultDocumentTime: incomeDoc.useDefaultDocumentTime,
                status: incomeDoc.status,
                accountToCode: incomeDoc.accountToCode,
                revenueAccountCode: incomeDoc.revenueAccountCode,
                defaultStore: incomeDoc.defaultStore,
                defaultStoreCode: incomeDoc.defaultStoreCode,
                supplier: incomeDoc.supplier,
                counteragentCode: incomeDoc.counteragentCode,
                linkedIncomingInvoiceId: incomeDoc.linkedIncomingInvoiceId,
                type: type,
              })
              .execute();
          } catch (e) {
            console.log("e", e);
          }
          for (const item of record.items[0].item) {
            try {
              let recordItem = {
                id:
                  item.id && (item.id[0] as string)
                    ? this.checkForNullString(item.id[0] as string)
                    : item.id,
                productId:
                  item.productId && item.productId[0]
                    ? (this.checkForNullString(item.productId[0]) as string)
                    : "",
                productArticle:
                  item.productArticle && item.productArticle[0]
                    ? (this.checkForNullString(
                        item.productArticle[0]
                      ) as string)
                    : "",
                storeId:
                  item.storeId && item.storeId[0]
                    ? (this.checkForNullString(item.storeId[0]) as string)
                    : "",
                storeCode:
                  item.storeCode && item.storeCode[0]
                    ? (item.storeCode[0] as string)
                    : "",
                price: +item.price[0],
                priceWithoutVat: +item.priceWithoutVat[0],
                amount: this.parseInteger(item.amount[0]),
                sum: +item.sum[0],
                discountSum: +item.discountSum[0],
                vatPercent: +item.vatPercent[0],
                vatSum: +item.vatSum[0],
                invoice_id: incomeDoc.id!.toString() || null,
                invoiceincomingdate:
                  record.dateIncoming && record.dateIncoming[0]
                    ? (this.checkForNullString(
                        record.dateIncoming[0]
                      ) as string)
                    : "",
                // amountUnit: item.amountUnit[0],
              };
              await drizzleDb
                .insert(invoice_items)
                .values(recordItem)
                .execute();
              // console.log("recordItem", recordItem);
            } catch (e) {
              console.log("e", e);
            }
          }
        } else {
          try {
            await drizzleDb
              .update(invoices)
              .set({
                documentNumber: incomeDoc.documentNumber?.toString(),
                // incomingDate: incomeDoc.incomingDate?.toString(),
                useDefaultDocumentTime:
                  incomeDoc.useDefaultDocumentTime as boolean,
                status: incomeDoc.status?.toString(),
                accountToCode: incomeDoc.accountToCode?.toString(),
                revenueAccountCode: incomeDoc.revenueAccountCode?.toString(),
                defaultStore: incomeDoc.defaultStore?.toString(),
                defaultStoreCode: incomeDoc.defaultStoreCode?.toString(),
                supplier: incomeDoc.supplier?.toString(),
                counteragentCode: incomeDoc.counteragentCode?.toString(),
                linkedIncomingInvoiceId:
                  incomeDoc.linkedIncomingInvoiceId?.toString(),
              })
              .where(eq(invoices.id, incomeDoc.id!));
          } catch (e) {
            console.log("e", e);
          }
          try {
            await drizzleDb
              .delete(invoice_items)
              .where(eq(invoice_items.invoice_id, incomeDoc.id!.toString()))
              .execute();
          } catch (e) {
            console.log("e", e);
          }
          for (const item of record.items[0].item) {
            // console.log("item", item);
            try {
              let recordItem = {
                id:
                  item.id && (item.id[0] as string)
                    ? this.checkForNullString(item.id[0] as string)
                    : item.id,
                productId:
                  item.productId && item.productId[0]
                    ? (this.checkForNullString(item.productId[0]) as string)
                    : "",
                productArticle:
                  item.productArticle && item.productArticle[0]
                    ? (this.checkForNullString(
                        item.productArticle[0]
                      ) as string)
                    : "",
                storeId:
                  item.storeId && item.storeId[0]
                    ? (this.checkForNullString(item.storeId[0]) as string)
                    : "",
                storeCode:
                  item.storeCode && item.storeCode[0]
                    ? (item.storeCode[0] as string)
                    : "",
                price: +item.price[0],
                priceWithoutVat: +item.priceWithoutVat,
                amount: this.parseInteger(item.amount[0]),
                sum: +item.sum,
                discountSum: +item.discountSum[0],
                vatPercent: +item.vatPercent[0],
                vatSum: +item.vatSum[0],
                invoice_id: incomeDoc.id!.toString() || null,
                invoiceincomingdate:
                  record.dateIncoming && record.dateIncoming[0]
                    ? (this.checkForNullString(
                        record.dateIncoming[0]
                      ) as string)
                    : "",
                // amountUnit: item.amountUnit[0],
              };
              await drizzleDb
                .insert(invoice_items)
                .values(recordItem)
                .execute();
            } catch (e) {
              console.log("e", e);
            }
          }
        }
      }

      console.timeEnd("outgoing_db_inserting");
      console.log("finished outgoing db inserting");
    });
  }

  async getIncomingInvoice(token: string, type: string = "incoming") {
    const fromDate = dayjs().subtract(50, "day").format("YYYY-MM-DD");
    const toDate = dayjs().format("YYYY-MM-DD");
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/documents/export/${type}Invoice?key=${token}&from=${fromDate}&to=${toDate}&includeDeleted=false`,
      {
        method: "GET",
      }
    );

    // console.log("response", response);
    // console.log("body", await response.text());

    const receiptInvoice = await response.text();
    // console.log("receiptInvoice", receiptInvoice);

    let incomeDoc = [];

    const incomeDocs = await drizzleDb.select().from(invoices).execute();

    xml2js.parseString(receiptInvoice, async (err, result) => {
      if (err) {
        throw err;
      }
      // console.log("result", result);
      console.log("started invoice db inserting");
      console.time("invoice_db_inserting");

      const docs = result[`${type}InvoiceDtoes`].document;

      for (const record of docs) {
        const incomeDoc = {
          id:
            record.id && record.id[0]
              ? (this.checkForNullString(record.id[0]) as string)
              : "",
          incomingDocumentNumber:
            record.incomingDocumentNumber && record.incomingDocumentNumber[0]
              ? this.checkForNullString(record.incomingDocumentNumber[0])
              : "",
          incomingDate:
            record.dateIncoming && record.dateIncoming[0]
              ? this.checkForNullString(record.dateIncoming[0])
              : "",
          useDefaultDocumentTime:
            record.useDefaultDocumentTime && record.useDefaultDocumentTime[0]
              ? this.checkForNullString(record.useDefaultDocumentTime[0])
              : "",
          incomingDocumentDate:
            record.incomingDocumentDate && record.incomingDocumentDate[0]
              ? this.checkForNullString(record.incomingDocumentDate[0])
              : "",
          dueDate:
            record.dueDate && record.dueDate[0]
              ? this.checkForNullString(record.dueDate[0])
              : "",
          supplier:
            record.supplier && record.supplier[0]
              ? this.checkForNullString(record.supplier[0])
              : "",
          defaultStore:
            record.defaultStore && record.defaultStore[0]
              ? this.checkForNullString(record.defaultStore[0])
              : "",
          invoice:
            record.invoice && record.invoice[0]
              ? this.checkForNullString(record.invoice[0])
              : "",
          documentNumber:
            record.documentNumber && record.documentNumber[0]
              ? this.checkForNullString(record.documentNumber[0])
              : "",
          comment:
            record.comment && record.comment[0]
              ? this.checkForNullString(record.comment[0])
              : "",
          status:
            record.status && record.status[0]
              ? this.checkForNullString(record.status[0])
              : "",
        };

        const existingIncomeDoc = incomeDocs.find(
          (existingIncomeDoc) => existingIncomeDoc.id === incomeDoc.id
        );

        if (!existingIncomeDoc) {
          try {
            await drizzleDb
              .insert(invoices)
              .values({
                id: incomeDoc.id,
                incomingDocumentNumber: incomeDoc.incomingDocumentNumber,
                incomingDate: incomeDoc.incomingDate,
                useDefaultDocumentTime: incomeDoc.useDefaultDocumentTime,
                dueDate: incomeDoc.dueDate,
                supplier: incomeDoc.supplier,
                defaultStore: incomeDoc.defaultStore,
                invoice: incomeDoc.invoice,
                documentNumber: incomeDoc.documentNumber,
                comment: incomeDoc.comment,
                status: incomeDoc.status,
                type: type,
              })
              .execute();
          } catch (e) {
            console.log("e", e);
          }
          try {
            for (const item of record.items[0].item) {
              // console.log("item", item);
              let recordItem = {
                id:
                  item.id && (item.id[0] as string)
                    ? this.checkForNullString(item.id[0] as string)
                    : item.id,
                isAdditionalExpense:
                  item.isAdditionalExpense &&
                  (item.isAdditionalExpense[0] as boolean)
                    ? (this.checkForNullString(
                        item.isAdditionalExpense[0]
                      ) as boolean)
                    : false,
                actualAmount: this.parseInteger(item.actualAmount[0] as string),
                storeId:
                  item.store && item.store[0]
                    ? (this.checkForNullString(item.store[0]) as string)
                    : "",
                // code: this.parseInteger(item.actualAmount),
                price: +item.price,
                priceWithoutVat: +item.priceWithoutVat,
                // priceUnit:
                //   item.priceUnit && item.priceUnit[0]
                //     ? (this.checkForNullString(item.priceUnit[0]) as string)
                //     : "",
                sum: +item.sum,
                vatPercent: +item.vatPercent,
                vatSum: +item.vatSum,
                discountSum: +item.discountSum,
                amountUnit:
                  item.amountUnit && item.amountUnit[0]
                    ? (this.checkForNullString(item.amountUnit[0]) as string)
                    : "",
                num:
                  item.num && (item.num[0] as string)
                    ? (this.checkForNullString(item.num[0]) as string)
                    : "",
                productId:
                  item.product && item.product[0]
                    ? (this.checkForNullString(item.product[0]) as string)
                    : "",
                productArticle:
                  item.productArticle && (item.productArticle[0] as string)
                    ? (this.checkForNullString(
                        item.productArticle[0]
                      ) as string)
                    : "",
                supplierProduct:
                  item.supplierProduct && item.supplierProduct[0]
                    ? (this.checkForNullString(
                        item.supplierProduct[0]
                      ) as string)
                    : "",
                supplierProductArticle:
                  item.supplierProductArticle && item.supplierProductArticle[0]
                    ? (this.checkForNullString(
                        item.supplierProductArticle[0]
                      ) as string)
                    : "",
                amount: this.parseInteger(item.amount[0] as string),
                invoice_id: incomeDoc.id!.toString() || null,
                invoiceincomingdate:
                  record.dateIncoming && (record.dateIncoming[0] as string)
                    ? (this.checkForNullString(
                        record.dateIncoming[0]
                      ) as string)
                    : "",
                // amount: this.parseInteger(item.amount),
              };
              // console.log("recordItem.id", recordItem.id);
              await drizzleDb
                .insert(invoice_items)
                .values(recordItem)
                .execute();
            }
          } catch (e) {
            console.log("e", e);
          }
        } else {
          try {
            await drizzleDb
              .update(invoices)
              .set({
                incomingDocumentNumber:
                  incomeDoc.incomingDocumentNumber?.toString(),
                // incomingDate: incomeDoc.incomingDate?.toString(),
                useDefaultDocumentTime:
                  incomeDoc.useDefaultDocumentTime as boolean,
                dueDate: incomeDoc.dueDate?.toString(),
                supplier: incomeDoc.supplier?.toString(),
                defaultStore: incomeDoc.defaultStore?.toString(),
                invoice: incomeDoc.invoice?.toString(),
                documentNumber: incomeDoc.documentNumber?.toString(),
                comment: incomeDoc.comment?.toString(),
                status: incomeDoc.status?.toString(),
              })
              .where(eq(invoices.id, incomeDoc.id!));
          } catch (e) {
            console.log("e", e);
          }
          try {
            await drizzleDb
              .delete(invoice_items)
              .where(eq(invoice_items.invoice_id, incomeDoc.id!.toString()))
              .execute();
          } catch (e) {
            console.log("e", e);
          }

          try {
            for (const item of record.items[0].item) {
              // console.log("item", item);
              let recordItem = {
                id:
                  item.id && (item.id[0] as string)
                    ? this.checkForNullString(item.id[0] as string)
                    : item.id,
                isAdditionalExpense:
                  item.isAdditionalExpense && item.isAdditionalExpense[0]
                    ? (this.checkForNullString(
                        item.isAdditionalExpense[0]
                      ) as boolean)
                    : false,
                actualAmount: this.parseInteger(item.actualAmount[0]),
                storeId:
                  item.store && item.store[0]
                    ? (this.checkForNullString(item.store[0]) as string)
                    : "",
                // actualAmount: this.parseInteger(item.actualAmount),
                // store:
                //   item.store && item.store[0]
                //     ? this.checkForNullString(item.store[0])
                //     : "",
                price: +item.price[0],
                priceWithoutVat: +item.priceWithoutVat,
                // priceUnit:
                //   item.priceUnit && item.priceUnit[0]
                //     ? (this.checkForNullString(item.priceUnit[0]) as string)
                //     : "",
                sum: +item.sum,
                vatPercent: +item.vatPercent,
                vatSum: +item.vatSum,
                discountSum: +item.discountSum,
                amountUnit:
                  item.amountUnit && item.amountUnit[0]
                    ? (this.checkForNullString(item.amountUnit[0]) as string)
                    : "",
                num:
                  item.num && item.num[0]
                    ? (this.checkForNullString(item.num[0]) as string)
                    : "",
                productId:
                  item.product && item.product[0]
                    ? (this.checkForNullString(item.product[0]) as string)
                    : "",
                productArticle:
                  item.productArticle && item.productArticle[0]
                    ? (this.checkForNullString(
                        item.productArticle[0]
                      ) as string)
                    : "",
                supplierProduct:
                  item.supplierProduct && item.supplierProduct[0]
                    ? (this.checkForNullString(
                        item.supplierProduct[0]
                      ) as string)
                    : "",
                supplierProductArticle:
                  item.supplierProductArticle && item.supplierProductArticle[0]
                    ? (this.checkForNullString(
                        item.supplierProductArticle[0]
                      ) as string)
                    : "",
                amount: this.parseInteger(item.amount[0] as string),
                invoice_id: incomeDoc.id!.toString() || null,
                invoiceincomingdate:
                  record.dateIncoming && record.dateIncoming[0]
                    ? (this.checkForNullString(
                        record.dateIncoming[0]
                      ) as string)
                    : "",
                // amount: this.parseInteger(item.amount),
              };
              // console.log("item", item);
              await drizzleDb
                .insert(invoice_items)
                .values(recordItem)
                .execute();
            }
          } catch (e) {
            console.log("e", e);
          }
          // // .where(eq(record.id, incomeDoc.id));
          // // .execute();
        }
      }

      console.timeEnd("invoice_db_inserting");
      console.log("finished invoice db inserting");
    });
  }

  async getTaxCategories(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=TaxCategory&key=${token}`,
      {
        method: "GET",
      }
    );

    const taxCategories = await response.json();

    const existingTaxCategories = await drizzleDb
      .select()
      .from(tax_category)
      .execute();

    for (const taxCategory of taxCategories) {
      const existingTaxCategory = existingTaxCategories.find(
        (existingTaxCategory) => existingTaxCategory.id === taxCategory.id
      );
      console.log("started tax_category db inserting");
      console.time("tax_category_db_inserting");
      if (!existingTaxCategory) {
        await drizzleDb
          .insert(tax_category)
          .values({
            id: taxCategory.id,
            deleted: taxCategory.deleted,
            name: taxCategory.name,
            code: taxCategory.code,
          })
          .execute();
      } else {
        await drizzleDb
          .update(tax_category)
          .set({
            deleted: taxCategory.deleted,
            name: taxCategory.name,
            code: taxCategory.code,
          })
          .where(eq(tax_category.id, taxCategory.id))
          .execute();
      }
      console.timeEnd("tax_category_db_inserting");
      console.log("finished tax_category db inserting");
    }
  }

  async getPaymentTypes(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=PaymentType&key=${token}`,
      {
        method: "GET",
      }
    );
    const paymentTypes = await response.json();
    // console.log("paymentTypes", paymentTypes);
    const existingPaymentTypes = await drizzleDb
      .select()
      .from(payment_type)
      .execute();

    for (const paymentType of paymentTypes) {
      const existingPaymentType = existingPaymentTypes.find(
        (existingPaymentType) => existingPaymentType.id === paymentType.id
      );
      // console.log("paymentType", paymentType);
      console.log("started payment_type db inserting");
      console.time("payment_type_db_inserting");
      if (!existingPaymentType) {
        await drizzleDb
          .insert(payment_type)
          .values({
            id: paymentType.id,
            deleted: paymentType.deleted,
            name: paymentType.name,
            code: paymentType.code,
          })
          .execute();
      } else {
        await drizzleDb
          .update(payment_type)
          .set({
            deleted: paymentType.deleted,
            name: paymentType.name,
            code: paymentType.code,
          })
          .where(eq(payment_type.id, paymentType.id))
          .execute();
      }
      console.timeEnd("payment_type_db_inserting");
      console.log("finished payment_type db inserting");
    }
  }

  async getOrderTypes(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=OrderType&key=${token}`,
      {
        method: "GET",
      }
    );
    const orderTypes = await response.json();

    const existingOrderTypes = await drizzleDb
      .select()
      .from(order_type)
      .execute();

    for (const orderType of orderTypes) {
      const existingOrderType = existingOrderTypes.find(
        (existingOrderType) => existingOrderType.id === orderType.id
      );
      console.log("started order_type db inserting");
      console.time("order_type_db_inserting");
      if (!existingOrderType) {
        await drizzleDb
          .insert(order_type)
          .values({
            id: orderType.id,
            deleted: orderType.deleted,
            name: orderType.name,
            code: orderType.code,
          })
          .execute();
      } else {
        await drizzleDb
          .update(order_type)
          .set({
            deleted: orderType.deleted,
            name: orderType.name,
            code: orderType.code,
          })
          .where(eq(order_type.id, orderType.id))
          .execute();
      }
      console.timeEnd("order_type_db_inserting");
      console.log("finished order_type db inserting");
    }
  }

  async getMeasureUnit(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=MeasureUnit&key=${token}`,
      {
        method: "GET",
      }
    );

    const measureUnits = await response.json();

    const existingMeasureUnits = await drizzleDb
      .select()
      .from(measure_unit)
      .execute();

    for (const measureUnit of measureUnits) {
      const existingMeasureUnit = existingMeasureUnits.find(
        (existingMeasureUnit) => existingMeasureUnit.id === measureUnit.id
      );
      // console.log("measureUnit", measureUnit);
      console.log("started MeasureUnit db inserting");
      console.time("MeasureUnit_db_inserting");
      try {
        if (!existingMeasureUnit) {
          await drizzleDb
            .insert(measure_unit)
            .values({
              id: measureUnit.id,
              deleted: measureUnit.deleted,
              name: measureUnit.name,
              code: measureUnit.code,
            })
            .execute();
        } else {
          await drizzleDb
            .update(measure_unit)
            .set({
              deleted: measureUnit.deleted,
              name: measureUnit.name,
              code: measureUnit.code,
            })
            .where(eq(measure_unit.id, measureUnit.id))
            .execute();
        }
      } catch (e) {
        console.log(e);
      }

      console.timeEnd("MeasureUnit_db_inserting");
      console.log("finished MeasureUnit db inserting");
    }
  }

  async getDiscountTypes(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=DiscountType&key=${token}`,
      {
        method: "GET",
      }
    );

    const discountTypes = await response.json();

    const existingDiscountTypes = await drizzleDb
      .select()
      .from(discount_type)
      .execute();

    for (const discountType of discountTypes) {
      const existingDiscountType = existingDiscountTypes.find(
        (existingDiscountType) => existingDiscountType.id === discountType.id
      );
      console.log("started DiscountTypes db inserting");
      console.time("DiscountTypes_db_inserting");
      if (!existingDiscountType) {
        await drizzleDb
          .insert(discount_type)
          .values({
            id: discountType.id,
            deleted: discountType.deleted,
            name: discountType.name,
            code: discountType.code,
          })
          .execute();
      } else {
        await drizzleDb
          .update(discount_type)
          .set({
            deleted: discountType.deleted,
            name: discountType.name,
            code: discountType.code,
          })
          .where(eq(discount_type.id, discountType.id))
          .execute();
      }
      console.timeEnd("DiscountTypes_db_inserting");
      console.log("finished DiscountTypes db inserting");
    }
  }

  async getConceptions(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=Conception&key=${token}`,
      {
        method: "GET",
      }
    );

    const conceptions = await response.json();

    const existingConceptions = await drizzleDb
      .select()
      .from(conception)
      .execute();

    for (const Conception of conceptions) {
      const existingConception = existingConceptions.find(
        (existingConception) => existingConception.id === Conception.id
      );
      console.log("started Conceptions db inserting");
      console.time("Conceptions_db_inserting");
      if (!existingConception) {
        await drizzleDb
          .insert(conception)
          .values({
            id: Conception.id,
            deleted: Conception.deleted,
            name: Conception.name,
            code: Conception.code,
          })
          .execute();
      } else {
        await drizzleDb
          .update(conception)
          .set({
            deleted: Conception.deleted,
            name: Conception.name,
            code: Conception.code,
          })
          .where(eq(conception.id, conception.id))
          .execute();
      }
      console.timeEnd("Conceptions_db_inserting");
      console.log("finished Conceptions db inserting");
    }
  }

  async getAccountingCategorys(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/list?rootType=AccountingCategory&key=${token}`,
      {
        method: "GET",
      }
    );

    const accountingCategorys = await response.json();

    const existingAccountingCategorys = await drizzleDb
      .select()
      .from(accounting_category)
      .execute();

    for (const accountingCategory of accountingCategorys) {
      const existingAccountingCategory = existingAccountingCategorys.find(
        (existingAccountingCategory) =>
          existingAccountingCategory.id === accountingCategory.id
      );
      console.log("started AccountingCategorys db inserting");
      console.time("AccountingCategorys_db_inserting");
      if (!existingAccountingCategory) {
        await drizzleDb
          .insert(accounting_category)
          .values({
            id: accountingCategory.id,
            deleted: accountingCategory.deleted,
            name: accountingCategory.name,
            code: accountingCategory.code,
          })
          .execute();
      } else {
        await drizzleDb
          .update(accounting_category)
          .set({
            deleted: accountingCategory.deleted,
            name: accountingCategory.name,
            code: accountingCategory.code,
          })
          .where(eq(accounting_category.id, accountingCategory.id))
          .execute();
      }
      console.timeEnd("AccountingCategorys_db_inserting");
      console.log("finished AccountingCategorys db inserting");
    }
  }

  async getNomenclatureGroups(token: string) {
    // console.log("davr");
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/products/group/list?key=${token}&includeDeleted=true`,
      {
        method: "GET",
      }
    );

    const nomenclatureGroups = await response.json();
    // console.log("nomenclatureGroups", nomenclatureGroups);
    const existingNomenclatureGroups = await drizzleDb
      .select()
      .from(nomenclature_group)
      .execute();

    // console.log("nomenclatureGroups", nomenclatureGroups);
    console.log("started NomenclatureGroups db inserting");
    console.time("NomenclatureGroups_db_inserting");

    for (const nomenclatureGroup of nomenclatureGroups) {
      const existingNomenclatureGroup = existingNomenclatureGroups.find(
        (existingNomenclatureGroup) =>
          existingNomenclatureGroup.id === nomenclatureGroup.id
      );
      if (!existingNomenclatureGroup) {
        try {
          await drizzleDb
            .insert(nomenclature_group)
            .values({
              id: nomenclatureGroup.id,
              deleted: nomenclatureGroup.deleted,
              name: nomenclatureGroup.name,
              tax_category_id: nomenclatureGroup.taxCategory,
              category_id: nomenclatureGroup.category,
              accounting_category_id: nomenclatureGroup.accountingCategory,
              parent_id: nomenclatureGroup.parentId,
            })
            .execute();
        } catch (e) {
          console.log(e);
        }
      } else {
        try {
          await drizzleDb
            .update(nomenclature_group)
            .set({
              deleted: nomenclatureGroup.deleted,
              name: nomenclatureGroup.name,
              tax_category_id: nomenclatureGroup.taxCategory,
              category_id: nomenclatureGroup.category,
              accounting_category_id: nomenclatureGroup.accountingCategory,
              parent_id: nomenclatureGroup.parentId,
            })
            .where(eq(nomenclature_group.id, nomenclatureGroup.id))
            .execute();
        } catch (e) {
          console.log(e);
        }
      }
    }
    console.timeEnd("NomenclatureGroups_db_inserting");
    console.log("finished NomenclatureGroups db inserting");
  }

  async getNomenclatureCatergorys(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/products/category/list?key=${token}&includeDeleted=true`,

      {
        method: "GET",
      }
    );

    const nomenclatureCategorys = await response.json();
    // console.log("nomenclatureCategorys", nomenclatureCategorys);

    const existingNomenclatureCategorys = await drizzleDb
      .select()
      .from(nomenclature_category)
      .execute();
    // console.log("nomenclatureCategorys", nomenclatureCategorys);
    for (const nomenclatureCategory of nomenclatureCategorys) {
      const existingNomenclatureCategory = existingNomenclatureCategorys.find(
        (existingNomenclatureCategory) =>
          existingNomenclatureCategory.id === nomenclatureCategory.id
      );
      console.log("started NomenclatureCatergorys db inserting");
      console.time("NomenclatureCatergorys_db_inserting");
      try {
        if (!existingNomenclatureCategory) {
          await drizzleDb
            .insert(nomenclature_category)
            .values({
              id: nomenclatureCategory.id,
              deleted: nomenclatureCategory.deleted,
              name: nomenclatureCategory.name,
              code: nomenclatureCategory.code,
            })
            .execute();
        } else {
          await drizzleDb
            .update(nomenclature_category)
            .set({
              deleted: nomenclatureCategory.deleted,
              name: nomenclatureCategory.name,
              code: nomenclatureCategory.code,
            })
            .where(eq(nomenclature_category.id, nomenclatureCategory.id))
            .execute();
        }
      } catch (e) {
        console.log(e);
      }
      console.timeEnd("NomenclatureCatergorys_db_inserting");
      console.log("finished NomenclatureCatergorys db inserting");
    }
  }

  async getNomenclatureElements(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/entities/products/list?key=${token}&includeDeleted=true`,
      {
        method: "GET",
      }
    );
    const nomenclatureElements = await response.json();
    // console.log("nomenclatureElements", nomenclatureElements.length);

    const existingNomenclatureElements = await drizzleDb
      .select()
      .from(nomenclature_element)
      .execute();
    // console.log("nomenclatureElements", nomenclatureElements);
    for (const nomenclatureElement of nomenclatureElements) {
      const existingNomenclatureElement = existingNomenclatureElements.find(
        (existingNomenclatureElement) =>
          existingNomenclatureElement.id === nomenclatureElement.id
      );
      console.log("started NomenclatureElements db inserting");
      console.time("NomenclatureElements_db_inserting");
      try {
        if (!existingNomenclatureElement) {
          // console.log("nomenclatureElement", nomenclatureElement);
          await drizzleDb
            .insert(nomenclature_element)
            .values({
              id: nomenclatureElement.id,
              deleted: nomenclatureElement.deleted,
              name: nomenclatureElement.name,
              description: nomenclatureElement.description,
              num: nomenclatureElement.num,
              tax_category_id: nomenclatureElement.taxCategory,
              category_id: nomenclatureElement.category,
              accounting_category_id: nomenclatureElement.accountingCategory,
              mainUnit: nomenclatureElement.mainUnit,
              type: nomenclatureElement.type,
              unitWeight: this.parseInteger(nomenclatureElement.unitWeight),
              unitCapacity: this.parseInteger(nomenclatureElement.unitCapacity),
            })
            .execute();
        } else {
          await drizzleDb
            .update(nomenclature_element)
            .set({
              deleted: nomenclatureElement.deleted,
              name: nomenclatureElement.name,
              description: nomenclatureElement.description,
              num: nomenclatureElement.num,
              tax_category_id: nomenclatureElement.taxCategory,
              category_id: nomenclatureElement.category,
              accounting_category_id: nomenclatureElement.accountingCategory,
              mainUnit: nomenclatureElement.mainUnit,
              type: nomenclatureElement.type,
              unitWeight: this.parseInteger(
                nomenclatureElement.unitWeight
              )?.toString(),
              unitCapacity: this.parseInteger(
                nomenclatureElement.unitCapacity
              )?.toString(),
            })
            .where(eq(nomenclature_element.id, nomenclatureElement.id))
            .execute();
        }
      } catch (e) {
        console.log(e);
      }
      console.timeEnd("NomenclatureElements_db_inserting");
      console.log("finished NomenclatureElements db inserting");
    }
  }

  async getSupplers(token: string) {
    const response = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/suppliers?key=${token}`,
      {
        method: "GET",
      }
    );
    // console.log("response", response);
    const supplierText = await response.text();

    // console.log("suppliers", suppliers);

    const existingSuppliers = await drizzleDb
      .select()
      .from(suppliers)
      .execute();

    xml2js.parseString(supplierText, async (err, result) => {
      if (err) {
        throw err;
      }
      // console.log("result", result.employees.employee);

      for (const supplier of result.employees.employee) {
        const suppliersItems = {
          id:
            supplier.id && supplier.id[0]
              ? this.checkForNullString(supplier.id[0] as string)
              : null,
          code:
            supplier.code && supplier.code[0]
              ? this.checkForNullString(supplier.code[0])
              : "",
          name:
            supplier.name && supplier.name[0]
              ? this.checkForNullString(supplier.name[0])
              : "",
          cardNumber:
            supplier.cardNumber && supplier.cardNumber[0]
              ? this.checkForNullString(supplier.cardNumber[0])
              : "",
          taxpayerIdNumber:
            supplier.taxpayerIdNumber && supplier.taxpayerIdNumber[0]
              ? this.checkForNullString(supplier.taxpayerIdNumber[0])
              : "",
          snils:
            supplier.snils && supplier.snils[0]
              ? this.checkForNullString(supplier.snils[0])
              : "",
          departmentCodes:
            supplier.departmentCodes && supplier.departmentCodes[0]
              ? this.checkForNullString(supplier.departmentCodes[0])
              : "",
          responsibilityDepartmentCodes:
            supplier.responsibilityDepartmentCodes &&
            supplier.responsibilityDepartmentCodes[0]
              ? this.checkForNullString(
                  supplier.responsibilityDepartmentCodes[0]
                )
              : "",
          deleted:
            supplier.deleted && (supplier.deleted[0] as boolean)
              ? (this.checkForNullString(supplier.deleted[0]) as boolean)
              : false,
          supplier:
            supplier.supplier && (supplier.supplier[0] as boolean)
              ? (this.checkForNullString(supplier.supplier[0]) as boolean)
              : false,
          employee:
            supplier.employee && (supplier.employee[0] as boolean)
              ? (this.checkForNullString(supplier.employee[0]) as boolean)
              : false,
          client:
            supplier.client && (supplier.client[0] as boolean)
              ? (this.checkForNullString(supplier.client[0]) as boolean)
              : false,
          representsStore:
            supplier.representsStore && (supplier.representsStore[0] as boolean)
              ? (this.checkForNullString(
                  supplier.representsStore[0]
                ) as boolean)
              : false,
          representedStoreId:
            supplier.representedStoreId &&
            (supplier.representedStoreId[0] as string)
              ? this.checkForNullString(
                  supplier.representedStoreId[0] as string
                )
              : null,
        };

        const existingSupplier = existingSuppliers.find(
          (existingSupplier) => existingSupplier.id === suppliersItems.id
        );

        console.log("started Supplers db inserting");
        console.time("Supplers_db_inserting");

        if (!existingSupplier) {
          try {
            await drizzleDb
              .insert(suppliers)
              .values({
                id: suppliersItems.id!.toString(),
                code: suppliersItems.code,
                name: suppliersItems.name,
                cardNumber: suppliersItems.cardNumber,
                taxpayerIdNumber: suppliersItems.taxpayerIdNumber,
                snils: suppliersItems.snils,
                departmentCodes: suppliersItems.departmentCodes,
                responsibilityDepartmentCodes:
                  suppliersItems.responsibilityDepartmentCodes,
                deleted: suppliersItems.deleted,
                supplier: suppliersItems.supplier,
                employee: suppliersItems.employee,
                client: suppliersItems.client,
                representsStore: suppliersItems.representsStore,
                representedStoreId:
                  suppliersItems.representedStoreId!.toString(),
              })
              .execute();
          } catch (e) {
            console.log("e", e);
          }
        } else {
          try {
            await drizzleDb
              .update(suppliers)
              .set({
                code: suppliersItems.code?.toString(),
                name: suppliersItems.name?.toString(),
                cardNumber: suppliersItems.cardNumber?.toString(),
                taxpayerIdNumber: suppliersItems.taxpayerIdNumber?.toString(),
                snils: suppliersItems.snils?.toString(),
                departmentCodes: suppliersItems.departmentCodes?.toString(),
                responsibilityDepartmentCodes:
                  suppliersItems.responsibilityDepartmentCodes?.toString(),
                deleted: suppliersItems.deleted,
                supplier: suppliersItems.supplier,
                employee: suppliersItems.employee,
                client: suppliersItems.client,
                representsStore: suppliersItems.representsStore,
                representedStoreId:
                  suppliersItems.representedStoreId?.toString(),
              })
              .where(eq(suppliers.id, suppliersItems.id!.toString()))
              .execute();
          } catch (e) {
            console.log("e", e);
          }
        }
        console.timeEnd("Supplers_db_inserting");
        console.log("finished Supplers db inserting");
      }
    });
  }
}

function where(arg0: SQL<unknown>) {
  throw new Error("Function not implemented.");
}
function execute() {
  throw new Error("Function not implemented.");
}
function insert(report_olap: unknown) {
  throw new Error("Function not implemented.");
}
