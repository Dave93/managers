import { internal_transfer_items } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type InternalTransferItemsListDto = InferSelectModel<
  typeof internal_transfer_items
> & {
  productName: string;
  measureUnitId: string;
  productArticle: string;
};
