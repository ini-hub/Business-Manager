import { db } from "../db";
import { eq } from "drizzle-orm";

export abstract class BaseRepository<TTable extends { id: any }> {
  protected table: TTable;

  constructor(table: TTable) {
    this.table = table;
  }

  /**
   * Find a single record by its primary ID key
   */
  public async findById(id: string): Promise<any | undefined> {
    const [record] = await db
      .select()
      .from(this.table as any)
      .where(eq((this.table as any).id, id));
    return record;
  }

  /**
   * Delete a single record by its primary ID key
   */
  public async deleteById(id: string): Promise<void> {
    await db.delete(this.table as any).where(eq((this.table as any).id, id));
  }
}
