// Temporary read-only diagnostic: lists tables and row counts in the
// production `hr` Postgres schema, so we know whether it's safe to retry
// the employee-portal migration or whether it needs cleanup first.
// Delete this file once the employee-portal migration issue is resolved.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const tables = await sql`select table_name from information_schema.tables where table_schema = 'hr'`;
console.log('Tables in hr schema:', JSON.stringify(tables));
for (const t of tables) {
  const count = await sql.query(`select count(*) from "hr"."${t.table_name}"`);
  console.log(t.table_name, '->', JSON.stringify(count));
}
