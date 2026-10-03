// Builds the spike's two Lambda packages in dist/: an x64 zip, and the build
// context for an arm64 container image. Both hold the bundled handler and a
// production install of LanceDB for their platform, without LanceDB's
// optional embedding providers. Options build other handlers, or one package.
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

export interface PackageOptions {
  // Each handler's module name and its source file in src/. Without it, the
  // package holds search's handler alone, as index.mjs.
  handlers?: Record<string, string>;
  // The packages to build. Without it, both.
  names?: Package["name"][];
}

export async function packageAll(options: PackageOptions = {}): Promise<Package[]> {
  rmSync(dist, { recursive: true, force: true });
  const handlers = options.handlers ?? { index: "lambda.ts" };
  const bundle = join(dist, "handlers");
  await build({
    entryPoints: Object.fromEntries(Object.entries(handlers).map(([name, source]) => [name, join(root, "src", source)])),
    outdir: bundle,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@lancedb/lancedb", "apache-arrow"],
    // The AWS SDK's CommonJS modules require Node's built-ins, which an ES
    // module can only do through a require of its own.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const code = new Map(Object.keys(handlers).map((name) => [`${name}.mjs`, readFileSync(join(bundle, `${name}.mjs`))]));
  return platforms.filter(({ name }) => options.names?.includes(name) ?? true).map(({ name, cpu }) => {
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
    for (const [file, bytes] of code) writeFileSync(join(dir, file), bytes);
    if (name === "arm64-image") {
      writeFileSync(join(dir, "Dockerfile"), 'FROM public.ecr.aws/lambda/nodejs:24\nCOPY . ${LAMBDA_TASK_ROOT}/\nCMD ["index.handler"]\n');
    }
    const file = join(dist, `${name}.zip`);
    execFileSync("zip", ["-qr", "-X", file, "."], { cwd: dir });
    const hash = createHash("sha256")
      .update(Buffer.concat([...code.values()]))
      .update(readFileSync(join(dir, "package-lock.json")))
      .digest("hex")
      .slice(0, 12);
    const unzippedBytes = Number(execFileSync("du", ["-sb", dir], { encoding: "utf8" }).split("\t")[0]);
    return { name, file, zipBytes: statSync(file).size, unzippedBytes, hash };
  });
}
