/** Captures this domain's explicit scalar SELECTs, including empty eligibility
 * sets. Validation runs in the same native batch as its mutation/receipt. */
import type { D1Store, D1Statement, SqlValue } from "./database";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { ResponsibilityError } from "../responsibility";
export function captureResponsibilityReads(database: D1Store) {
  const observed: Array<{
    sql: string;
    values: SqlValue[];
    columns: string[];
    rows: SqlValue[][];
  }> = [];
  const session = database.withSession("first-primary");
  function prepare(sql: string, values: SqlValue[] = []): D1Statement {
    if (!/^\s*SELECT\b/i.test(sql))
      throw new ResponsibilityError("UNAVAILABLE");
    const statement = session.prepare(sql).bind(...values);
    function record(rows: Record<string, unknown>[]) {
      const columns = Object.keys(rows[0] ?? {});
      const tuples = rows.map((row) =>
        columns.map((column) => {
          const value = row[column];
          if (
            value !== null &&
            typeof value !== "string" &&
            !(typeof value === "number" && Number.isSafeInteger(value))
          )
            throw new ResponsibilityError("UNAVAILABLE");
          return value as SqlValue;
        }),
      );
      observed.push({ sql, values, columns, rows: tuples });
    }
    return {
      bind: (...args) => prepare(sql, args),
      async first<T>() {
        const row = await statement.first<Record<string, unknown>>();
        record(row ? [row] : []);
        return row as T | null;
      },
      async all<T>() {
        const result = await statement.all<Record<string, unknown>>();
        record(result.results);
        return { ...result, results: result.results as T[] };
      },
      async run() {
        throw new ResponsibilityError("UNAVAILABLE");
      },
    };
  }
  const read: D1Store = {
    prepare,
    async batch() {
      throw new ResponsibilityError("UNAVAILABLE");
    },
    withSession: () => read,
  };
  return {
    read,
    checks(target: Pick<D1Store, "prepare">) {
      return observed.map(({ sql, values, columns, rows }) =>
        columns.length
          ? d1WriteCheck(
              target,
              `(SELECT json_group_array(json_array(${columns.map((c) => '"' + c.replaceAll('"', '""') + '"').join(",")})) FROM (${sql})) IS ?`,
              [...values, JSON.stringify(rows)],
            )
          : d1WriteCheck(target, `NOT EXISTS (${sql})`, values),
      );
    },
  };
}
export async function validatedResponsibilityRead<T>(
  database: D1Store,
  read: (db: D1Store) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const capture = captureResponsibilityReads(database),
      value = await read(capture.read);
    try {
      await database
        .withSession("first-primary")
        .batch(capture.checks(database));
      return value;
    } catch (error) {
      if (!isD1WriteConflict(error)) throw error;
    }
  }
  throw new ResponsibilityError("CONFLICT");
}
