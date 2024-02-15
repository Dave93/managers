export type Stoplist = {
    id: string,
    productId: string,
    terminalId: string,
    organizationId: string,
    dateAdd: string,
    dateRemoved: string,
    status: string,
    difference: number,
    reason: string,
    responsible: string,
    comment: string,
    solve_status: string;
    productName: string;
    terminalName: string;
    categoryName: string;
}