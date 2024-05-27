import { nomenclature_element } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export interface ProductGroupsListDto extends InferSelectModel<typeof nomenclature_element> {
    group_id: string;
}