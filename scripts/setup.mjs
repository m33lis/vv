// Windows x64 project-local tools. Requires Node 24 and Maven 3.9+ on PATH.
import { mkdir, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
if (process.platform !== "win32" || process.arch !== "x64")
  throw Error("Use the Docker Compose setup on other platforms.");
await mkdir(".tools", { recursive: true });
const exists = async (p) =>
  access(p).then(
    () => true,
    () => false,
  );
async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error(`${r.status}: ${url}`);
  return r;
}
async function download(url, path, hash, algorithm = "sha256") {
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  if (
    createHash(algorithm).update(bytes).digest("hex") !==
    hash.trim().split(/\s/)[0]
  )
    throw Error(`Checksum mismatch: ${path}`);
  await writeFile(path, bytes);
}
if (!(await exists(".tools/package/bin/npm-cli.js"))) {
  const metadata = await (
    await get("https://registry.npmjs.org/npm/11.6.2")
  ).json();
  await download(
    metadata.dist.tarball,
    ".tools/npm.tgz",
    metadata.dist.shasum,
    "sha1",
  );
  execFileSync("tar", ["-xzf", ".tools/npm.tgz", "-C", ".tools"]);
}
if (!(await exists(".tools/java"))) {
  const assets = await (
    await get(
      "https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jdk&os=windows",
    )
  ).json();
  const pkg = assets[0].binary.package;
  await download(pkg.link, ".tools/jdk.zip", pkg.checksum);
  await mkdir(".tools/java", { recursive: true });
  execFileSync("tar", ["-xf", ".tools/jdk.zip", "-C", ".tools/java"]);
}
if (!(await exists(".tools/postgres/bin/postgres.exe"))) {
  const url =
    "https://repo.maven.apache.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/17.11.0/embedded-postgres-binaries-windows-amd64-17.11.0.jar";
  await download(
    url,
    ".tools/postgres.jar",
    await (await get(url + ".sha256")).text(),
  );
  await mkdir(".tools/pg-package", { recursive: true });
  await mkdir(".tools/postgres", { recursive: true });
  execFileSync("tar", [
    "-xf",
    ".tools/postgres.jar",
    "-C",
    ".tools/pg-package",
  ]);
  execFileSync("tar", [
    "-xf",
    ".tools/pg-package/postgres-windows-x86_64.txz",
    "-C",
    ".tools/postgres",
  ]);
}
execFileSync(
  process.execPath,
  [
    ".tools/package/bin/npm-cli.js",
    "install",
    "pg@8.16.3",
    "--prefix",
    ".tools",
    "--cache",
    ".tools/npm-cache",
    "--no-fund",
    "--no-audit",
  ],
  { stdio: "inherit" },
);
console.log("Tools ready. Run ./scripts/start.ps1");
