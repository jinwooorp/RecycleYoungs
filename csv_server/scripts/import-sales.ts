// 💡 파일의 무조건 '최상단'에 이 코드를 추가하여 .env 파일을 읽어옵니다.
import 'dotenv/config'; 
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { Client } from 'pg';

async function main() {
  // 💡 디버깅용: 연결 정보가 정상적으로 로드되었는지 비밀번호만 가려서 콘솔에 찍어봅니다.
  console.log("🔄 DB 연결을 설정하는 중입니다...");
  console.log("- DATABASE_URL 존재 여부:", !!process.env.DATABASE_URL);
  console.log("- PGUSER:", process.env.PGUSER);
  console.log("- PGPASSWORD 존재 여부:", !!process.env.PGPASSWORD);

  // 1. DB 클라이언트 설정 (본인의 환경 변수 이름에 맞게 세팅하세요)
  const client = new Client({
    // 만약 DATABASE_URL 통째로 쓰신다면 아래처럼 사용
    connectionString: "postgresql://1234:1234@localhost:5432/recycle_analysis"
    
    // 개별 변수로 쓰신다면 아래 주석을 풀고 사용하세요
    // user: process.env.DB_USER,
    // host: process.env.DB_HOST,
    // database: process.env.DB_NAME,
    // password: String(process.env.DB_PASSWORD), // 💡 확실하게 string으로 형변환
    // port: Number(process.env.DB_PORT),
  });

  try {
    console.log("🔄 DB 연결 시도 중...");
    await client.connect();
    console.log("✅ Connected to the database.");

    // ... (이후 CSV 파싱 및 upsertStores 호출 코드는 동일)

  } catch (error) {
    console.error("❌ 에러 발생:", error);
  } finally {
    await client.end();
  }
}

main();
