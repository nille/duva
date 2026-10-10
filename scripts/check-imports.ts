// Fails if an entry of @duva/api fails to load on its own, or if the API's modules import each
// other in a cycle (#160). A cycle loads only in some orders: an entry that reaches it from the
// other side finds a binding it needs not yet initialized, as check-deployment.ts did importing
// @duva/api/indexing, while the Lambdas' bundles happened to load it in an order that works.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "packages/api/src");

// Type-only imports are erased before Node runs the code, so only the imports left at run time count.
// Dynamic imports load later, once every module has, so they close no cycle.
function runtimeImports(file: string): string[] {
  const parsed = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const imports: string[] = [];
  for (const statement of parsed.statements) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(statement)) {
      // Under verbatimModuleSyntax only `import type` goes. `import { type A }` stays, as an import
      // of nothing that still loads the module.
      const typeOnly = statement.importClause?.isTypeOnly === true;
      if (!typeOnly) specifier = statement.moduleSpecifier;
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      specifier = statement.moduleSpecifier;
    }
    if (specifier !== undefined && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
      imports.push(resolve(dirname(file), specifier.text));
    }
  }
  return imports;
}

const files = readdirSync(source, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
  .map((name) => join(source, name))
  .sort();
const graph = new Map(files.map((file) => [file, runtimeImports(file).filter((target) => target.startsWith(source))]));

// A depth-first walk finds a cycle each time it comes back to a module it is still inside.
const cycles: string[][] = [];
const done = new Set<string>();
const path: string[] = [];
function visit(file: string): void {
  const at = path.indexOf(file);
  if (at >= 0) {
    cycles.push([...path.slice(at), file]);
    return;
  }
  if (done.has(file)) return;
  path.push(file);
  for (const target of graph.get(file) ?? []) visit(target);
  path.pop();
  done.add(file);
}
for (const file of files) visit(file);

// Each entry loads in a Node process of its own, as check-deployment.ts and a Lambda load theirs. A
// Lambda's handler module reads its environment once everything it imports has loaded, so an unset
// variable is as far as one gets here.
const { exports } = JSON.parse(readFileSync(join(root, "packages/api/package.json"), "utf8")) as { exports: Record<string, string> };
const unset = /^Error: The environment variable \w+ is not set$/m;
const failed = (
  await Promise.all(
    Object.keys(exports).map(async (entry) => {
      const name = `@duva/api/${entry.slice(2)}`;
      const loading = `import(${JSON.stringify(name)}).then(() => process.exit(0), (error) => { console.error(String(error?.stack ?? error)); process.exit(1); })`;
      try {
        await promisify(execFile)(process.execPath, ["--input-type=module", "-e", loading], { cwd: root, timeout: 60_000 });
        return [];
      } catch (error) {
        const { stderr } = error as { stderr: string };
        return entry.endsWith("lambda") && unset.test(stderr) ? [] : [`  ${name}: ${stderr.trim().split("\n").slice(0, 3).join("\n    ")}`];
      }
    }),
  )
).flat();

if (cycles.length > 0) {
  const shown = cycles.map((cycle) => `  ${cycle.map((file) => relative(source, file)).join(" -> ")}`);
  console.error(`Import cycles in packages/api/src. Move what both sides need into a module they both import:\n${shown.join("\n")}`);
}
if (failed.length > 0) console.error(`These entries of @duva/api fail to load on their own:\n${failed.join("\n")}`);
if (cycles.length > 0 || failed.length > 0) process.exit(1);
