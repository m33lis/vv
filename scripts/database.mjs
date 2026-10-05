import { createRequire } from "node:module";
const require = createRequire(
  new URL("../.tools/package.json", import.meta.url),
);
const { Client } = require("pg");
let connected;
for (let attempt = 0; attempt < 20; attempt++) {
  const client = new Client({
    host: "127.0.0.1",
    port: 54329,
    user: "vv",
    password: "vv-local",
    database: "postgres",
  });
  try {
    await client.connect();
    connected = client;
    break;
  } catch {
    await client.end().catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!connected)
  throw Error("PostgreSQL did not become ready at 127.0.0.1:54329");
try {
  const { rows } = await connected.query(
    "SELECT 1 FROM pg_database WHERE datname='vv'",
  );
  if (!rows.length) await connected.query("CREATE DATABASE vv");
  console.log("VV database ready.");
} finally {
  await connected.end();
}
