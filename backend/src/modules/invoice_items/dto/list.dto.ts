import { invoice_items } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type InvoiceItemsListDto = InferSelectModel<typeof invoice_items> & {
  productName: string;
  unit: string;
  productArticle: string;
  sum: number;
  
};
