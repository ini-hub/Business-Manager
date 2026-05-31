import { Pool, types } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import fs from "fs";
import path from "path";

// Automatically parse decimal/numeric columns (OID 1700) as numbers
types.setTypeParser(1700, (val: string) => parseFloat(val));

// Force PostgreSQL timestamps (without timezone, OID 1114) to be parsed as UTC
types.setTypeParser(1114, (val: string) => new Date(val + "Z"));

// Manually load .env file if DATABASE_URL is not already in env
if (!process.env.DATABASE_URL) {
  try {
    const envPath = path.resolve(".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      envContent.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.warn("Could not load .env manually:", err);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
