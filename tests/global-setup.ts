import { execSync } from "node:child_process";

// 테스트 전용 스키마(test)에 테이블을 만든다. 기존 데이터는 지우지 않으며 개발 데이터도 건드리지 않는다.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://ilson:ilson@localhost:5432/ilson?schema=test";
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
