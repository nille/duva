// Packs what duva deploy ships into dist/deploy.tar.gz, which the compiled binary embeds: the
// cloud assembly synthesized from the CDK app (npm run synth), the CDK bootstrap template, and the
// web app (npm run build -w @duva/web).
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BootstrapSource, BootstrapTemplate } from "@aws-cdk/toolkit-lib";

const infra = dirname(fileURLToPath(import.meta.resolve("@duva/infra/package.json")));
const assembly = join(infra, "dist", "assembly");
if (!existsSync(join(assembly, "manifest.json"))) {
  throw new Error(`There is no cloud assembly in ${assembly}. Run npm run synth first.`);
}

const web = join(dirname(fileURLToPath(import.meta.resolve("@duva/web/package.json"))), "dist");
if (!existsSync(join(web, "index.html"))) {
  throw new Error(`There is no web app in ${web}. Run npm run build -w @duva/web first.`);
}

const files: Record<string, Uint8Array | string> = {};
for (const [name, directory] of [["assembly", assembly], ["web", web]] as const) {
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[join(name, relative(directory, path))] = await Bun.file(path).bytes();
  }
}
// Inside the binary, the toolkit can't find the template in its own package, so it ships a copy.
files["bootstrap-template.yaml"] = (await BootstrapTemplate.fromSource(BootstrapSource.default())).asYAML();

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
await mkdir(dist, { recursive: true });
await Bun.Archive.write(join(dist, "deploy.tar.gz"), files, { compress: "gzip" });
