// Builds the spike's two Lambda packages in dist/: an x64 zip, and the build
// context for an arm64 container image. Both hold the bundled handler and a
// production install of LanceDB for their platform, without LanceDB's
// optional embedding providers.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const spike = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export interface Package {
  name: "x64-zip" | "arm64-image";
  // A zip: the function's code, or the image's build context.
  file: string;
  zipBytes: number;
  unzippedBytes: number;
  // Changes when the handler or the dependencies change.
  hash: string;
}

const platforms = [
  { name: "x64-zip", cpu: "x64" },
  { name: "arm64-image", cpu: "arm64" },
] as const;

export async function packageAll(): Promise<Package[]> {
  rmSync(dist, { recursive: true, force: true });
  const handler = join(dist, "index.mjs");
  await build({
    entryPoints: [join(root, "src/lambda.ts")],
    outfile: handler,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@lancedb/lancedb", "apache-arrow"],
    // The AWS SDK's CommonJS modules require Node's built-ins, which an ES
    // module can only do through a require of its own.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  return platforms.map(({ name, cpu }) => {
    const dir = join(dist, name);
    mkdirSync(dir, { recursive: true });
    const dependencies = {
      "@lancedb/lancedb": spike.dependencies["@lancedb/lancedb"],
      [`@lancedb/lancedb-linux-${cpu}-gnu`]: spike.dependencies["@lancedb/lancedb"],
      "apache-arrow": spike.dependencies["apache-arrow"],
    };
    const manifest = JSON.stringify({ private: true, type: "module", dependencies }, null, 2);
    writeFileSync(join(dir, "package.json"), manifest);
    // --force, because npm otherwise refuses a direct dependency built for
    // another CPU than this machine's.
    execFileSync(
      "npm",
      ["install", "--os=linux", `--cpu=${cpu}`, "--libc=glibc", "--omit=optional", "--ignore-scripts", "--force", "--no-audit", "--no-fund"],
      { cwd: dir, stdio: "ignore" },
    );
    writeFileSync(join(dir, "index.mjs"), readFileSync(handler));
    if (name === "arm64-image") {
      writeFileSync(join(dir, "Dockerfile"), 'FROM public.ecr.aws/lambda/nodejs:24\nCOPY . ${LAMBDA_TASK_ROOT}/\nCMD ["index.handler"]\n');
    }
    const file = join(dist, `${name}.zip`);
    execFileSync("zip", ["-qr", "-X", file, "."], { cwd: dir });
    const hash = createHash("sha256")
      .update(readFileSync(handler))
      .update(readFileSync(join(dir, "package-lock.json")))
      .digest("hex")
      .slice(0, 12);
    const unzippedBytes = Number(execFileSync("du", ["-sb", dir], { encoding: "utf8" }).split("\t")[0]);
    return { name, file, zipBytes: statSync(file).size, unzippedBytes, hash };
  });
}
