// Generates code from the OpenAPI document, the only source of Duva's API contract (ADR-0009).
//
//   node scripts/generate.ts           writes the generated files
//   node scripts/generate.ts --check   fails if any generated file is stale
import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import { parse } from "yaml";
import duva from "../package.json" with { type: "json" };

const documentPath = "packages/openapi/openapi.yaml";
const header = `// Generated from ${documentPath} by scripts/generate.ts. Do not edit. Run npm run generate.\n\n`;
const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

interface Document {
  info: { version: string };
  security?: SecurityRequirement[];
  paths: Record<string, Partial<Record<(typeof methods)[number], OperationObject>>>;
  components?: { schemas?: Record<string, SchemaObject> };
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  security?: SecurityRequirement[];
  parameters?: ParameterObject[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: SchemaObject }> };
  "x-cli-command"?: string;
}

interface SchemaObject {
  $ref?: string;
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaObject & { description?: string }>;
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: { type?: string };
}

type SecurityRequirement = Record<string, string[]>;

const root = new URL("../", import.meta.url);
const documentUrl = new URL(documentPath, root);
const document = parse(await readFile(documentUrl, "utf8")) as Document;

if (document.info.version !== duva.version) {
  fail(`${documentPath} says version ${document.info.version}, but Duva is ${duva.version}. Make them match.`);
}

const files = new Map([
  ["packages/openapi/src/schema.gen.ts", header + astToString(await openapiTS(documentUrl))],
  [
    "packages/openapi/src/operations.gen.ts",
    `${header}export const operations = ${JSON.stringify(operationsOf(document), null, 2)} as const;\n`,
  ],
]);

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const [file, content] of files) {
    const current = await readFile(new URL(file, root), "utf8").catch(() => undefined);
    if (current !== content) stale.push(file);
  }
  if (stale.length > 0) fail(`Generated code is stale: ${stale.join(", ")}. Run npm run generate.`);
} else {
  for (const [file, content] of files) await writeFile(new URL(file, root), content);
}

function operationsOf(document: Document) {
  const operations = Object.entries(document.paths).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = item[method];
      if (operation === undefined) return [];
      const where = `${method.toUpperCase()} ${path}`;
      if (!operation.operationId) fail(`${where} has no operationId.`);
      if (!operation.summary) fail(`${where} has no summary.`);
      if (!operation["x-cli-command"]) fail(`${where} has no x-cli-command.`);
      return [
        {
          operationId: operation.operationId,
          method,
          path,
          routeKey: `${method.toUpperCase()} ${path}`,
          summary: operation.summary,
          signIn: needsSignIn(operation.security ?? document.security ?? []),
          command: operation["x-cli-command"].split(" "),
          options: [...parametersOf(where, operation.parameters ?? []), ...bodyOf(where, operation.requestBody)],
        },
      ];
    }),
  );
  const commands = operations.map((operation) => operation.command.join(" "));
  const repeated = commands.find((command, index) => commands.indexOf(command) !== index);
  if (repeated !== undefined) fail(`Two operations have the x-cli-command "${repeated}".`);
  return operations;
}

/** The operation's query and path parameters, which the CLI takes as options. */
function parametersOf(where: string, parameters: ParameterObject[]) {
  return parameters.map((parameter) => {
    if (parameter.in !== "query" && parameter.in !== "path") fail(`${where} has a ${parameter.in} parameter, which the CLI can't pass yet.`);
    return option(where, parameter.in, parameter.name, parameter.schema?.type, parameter.required ?? false, parameter.description);
  });
}

/** The properties of the operation's JSON body, which the CLI takes as options too. */
function bodyOf(where: string, body: OperationObject["requestBody"]) {
  if (body === undefined) return [];
  const schema = resolve(body.content?.["application/json"]?.schema);
  if (schema?.type !== "object") fail(`${where} has a body that isn't a JSON object, which the CLI can't pass yet.`);
  return Object.entries(schema.properties ?? {}).map(([name, property]) =>
    option(where, "body", name, property.type, schema.required?.includes(name) ?? false, property.description),
  );
}

function option(where: string, place: "query" | "path" | "body", name: string, type: string | undefined, required: boolean, description = "") {
  if (type !== "integer" && type !== "string") fail(`${where} has the parameter ${name} of type ${type}, which the CLI can't pass yet.`);
  return { name, in: place, type, required, description };
}

function resolve(schema: SchemaObject | undefined): SchemaObject | undefined {
  const name = schema?.$ref?.replace("#/components/schemas/", "");
  return name === undefined ? schema : document.components?.schemas?.[name];
}

/** Whether a caller must sign in. An empty requirement ({}) makes sign-in optional. */
function needsSignIn(security: SecurityRequirement[]): boolean {
  return security.length > 0 && security.every((requirement) => Object.keys(requirement).length > 0);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
