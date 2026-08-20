import { Pool } from "pg";
declare function getPool(): Pool;
export declare function query<T = any>(text: string, params?: any[]): Promise<T[]>;
export declare function queryOne<T = any>(text: string, params?: any[]): Promise<T | null>;
export declare function execute(text: string, params?: any[]): Promise<{
    rowCount: number | null;
    rows: any[];
}>;
export declare function testConnection(): Promise<boolean>;
export default getPool;
//# sourceMappingURL=database.d.ts.map