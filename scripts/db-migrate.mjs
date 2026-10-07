import { migrate, pool } from "../mock/postgres-store.mjs";
try { await migrate(); console.log("PostgreSQL schema ready"); }
catch (error) { console.error("PostgreSQL migration failed:", error); process.exitCode = 1; }
finally { await pool.end(); }
