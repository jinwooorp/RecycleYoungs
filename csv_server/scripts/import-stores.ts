import 'dotenv/config';
import fs from "fs";
import { parse } from "csv-parse/sync";
import pg from "pg";
import type { Client as PgClient } from 'pg';

interface StoreRecord {
  id: string | number; 
  name: string;
  industry: string;
  latitude: string | number;
  longitude: string | number;
}

const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://1234:1234@localhost:5432/recycle_analysis"
});

// 💡 1. 유지보수를 위해 upsertStores 함수를 main 함수 밖으로 독립시켰습니다.
async function upsertStores(client: PgClient, records: StoreRecord[]): Promise<void> {
  if (!records || records.length === 0) return;

  const values: any[] = [];
  const valuePlaceholders: string[] = [];
  let index = 1;

  for (const row of records) {
    values.push(
      row.id, 
      row.name, 
      row.industry, 
      Number(row.latitude), 
      Number(row.longitude)
    );
    
    valuePlaceholders.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4})`);
    index += 5;
  }

  const query = `
    INSERT INTO test_store (id, name, industry, latitude, longitude)
    VALUES ${valuePlaceholders.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      industry = EXCLUDED.industry,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude;
  `;

  console.log("🚀 DB에 벌크 Upsert 전송 중...");
  await client.query(query, values);
}

async function main() {
  try {
    await client.connect();
    console.log("✅ Connected to the database.");

    const csv = fs.readFileSync("data/raw/stores.csv", "utf-8");
    const records = parse(csv, {
        columns: true,
        skip_empty_lines: true,
    });

    console.log(`📊 Parsed ${records.length} records from the CSV file.`);

    // 💡 2. [가장 중요] 선언했던 함수를 여기서 실제로 실행해주어야 합니다!
    await upsertStores(client, records as StoreRecord[]);
    console.log("🎉 모든 데이터가 성공적으로 Upsert 되었습니다.");

  } catch (error) {
    console.error("❌ 실행 중 에러 발생:", error);
  } finally {
    // 💡 3. [중요] 작업이 끝나면 DB 연결을 끊어주어야 터미널이 멈추지 않고 즉시 종료됩니다.
    await client.end();
    console.log("🔌 DB 연결이 정상적으로 종료되었습니다.");
  }
}

main();
