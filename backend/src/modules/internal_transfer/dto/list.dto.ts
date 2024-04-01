import { internal_transfer } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type InternalTransferListDto = InferSelectModel<
  typeof internal_transfer
> & {
  productName: string;
  amount: number;
  fromStoreName: string;
  toStoreName: string;
};
