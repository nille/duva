// Generates code from the OpenAPI document, the only source of Duva's API contract (ADR-0009), and
// the list of measured models from Coo's evaluation (ADR-0035).
//
//   node scripts/generate.ts           writes the generated files
//   node scripts/generate.ts --check   fails if any generated file is stale
import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import { parse } from "yaml";
import duva from "../package.json" with { type: "json" };
import { answersPath, measuredModelsSource, researchPath } from "./measured-models.ts";

const documentPath = "packages/openapi/openapi.yaml";
const header = `// Generated from ${documentPath} by scripts/generate.ts. Do not edit. Run npm run generate.\n\n`;
const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

interface Document {
  info: { version: string };
  security?: SecurityRequirement[];
  paths: Record<string, Partial<Record<(typeof methods)[number], OperationObject>>>;
  components?: { schemas?: Record<string, SchemaObject>; parameters?: Record<string, ParameterObject> };
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  security?: SecurityRequirement[];
  parameters?: (ParameterObject | { $ref: string })[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: SchemaObject }> };
  "x-cli-command"?: string;
  /** For an operation on All mailboxes, the command it serves when given --mailbox all, in place of x-cli-command. */
  "x-cli-all-mailboxes"?: string;
}

interface SchemaObject {
  $ref?: string;
  anyOf?: SchemaObject[];
  type?: string;
  items?: SchemaObject;
  required?: string[];
  description?: string;
  properties?: Record<string, SchemaObject>;
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
  [
    "packages/api/src/measured-models.gen.ts",
    await measuredModelsSource(root, `// Generated from ${answersPath} and ${researchPath} by scripts/generate.ts. Do not edit. Run npm run generate.\n\n`).catch((error: Error) => fail(error.message)),
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
      const allMailboxes = operation["x-cli-all-mailboxes"];
      if (!operation["x-cli-command"] === !allMailboxes) fail(`${where} needs one of x-cli-command and x-cli-all-mailboxes.`);
      return [
        {
          operationId: operation.operationId,
          method,
          path,
          routeKey: `${method.toUpperCase()} ${path}`,
          summary: operation.summary,
          description: operation.description?.trim() ?? "",
          signIn: needsSignIn(operation.security ?? document.security ?? []),
          command: (operation["x-cli-command"] ?? allMailboxes!).split(" "),
          ...(allMailboxes && { allMailboxes: true }),
          options: [...parametersOf(where, operation.parameters ?? []), ...bodyOf(where, operation.requestBody)],
        },
      ];
    }),
  );
  // An operation on All mailboxes serves a command of an operation on one mailbox, given --mailbox all.
  for (const group of [operations.filter((operation) => !("allMailboxes" in operation)), operations.filter((operation) => "allMailboxes" in operation)]) {
    const commands = group.map((operation) => operation.command.join(" "));
    const repeated = commands.find((command, index) => commands.indexOf(command) !== index);
    if (repeated !== undefined) fail(`Two operations have the x-cli-command or x-cli-all-mailboxes "${repeated}".`);
  }
  for (const operation of operations.filter((each) => "allMailboxes" in each)) {
    const served = operations.find((each) => !("allMailboxes" in each) && each.command.join(" ") === operation.command.join(" "));
    if (!served?.options.some(({ name, in: place }) => name === "mailbox" && place === "path")) fail(`${operation.operationId} serves "${operation.command.join(" ")}", which no operation on one mailbox has.`);
  }
  return operations;
}

/** The operation's query and path parameters, which the CLI takes as options. */
function parametersOf(where: string, parameters: NonNullable<OperationObject["parameters"]>) {
  return parameters.map((given) => {
    const parameter = "$ref" in given ? document.components?.parameters?.[given.$ref.replace("#/components/parameters/", "")] : given;
    if (parameter === undefined) fail(`${where} refers to a parameter the document doesn't have.`);
    if (parameter.in !== "query" && parameter.in !== "path") fail(`${where} has a ${parameter.in} parameter, which the CLI can't pass yet.`);
    // A list of strings in the query is an option given once per item, as a body's is.
    const schema = parameter.schema as SchemaObject | undefined;
    const type = schema?.type === "array" && resolve(schema.items as SchemaObject | undefined)?.type === "string" ? "strings" : schema?.type;
    return option(where, parameter.in, parameter.name, type, parameter.required ?? false, parameter.description);
  });
}

/**
 * The properties of the operation's JSON body, which the CLI takes as options too. A list of
 * strings is an option given once per item, and a property that may be null, as anyOf it and
 * null, is nullable, which the CLI gives as --no-<name>.
 */
function bodyOf(where: string, body: OperationObject["requestBody"]) {
  if (body === undefined) return [];
  const schema = resolve(body.content?.["application/json"]?.schema);
  if (schema?.type !== "object") fail(`${where} has a body that isn't a JSON object, which the CLI can't pass yet.`);
  return Object.entries(schema.properties ?? {}).map(([name, given]) => {
    const others = given.anyOf?.filter(({ type }) => type !== "null");
    if (others !== undefined && (others.length !== 1 || others.length === given.anyOf!.length)) fail(`${where} has the property ${name} that is anyOf other than one type and null, which the CLI can't pass yet.`);
    const property = resolve(others?.[0] ?? given) ?? given;
    const type = property.type === "array" && resolve(property.items as SchemaObject | undefined)?.type === "string" ? "strings" : property.type;
    return { ...option(where, "body", name, type, schema.required?.includes(name) ?? false, given.description ?? property.description), ...(others !== undefined && { nullable: true }) };
  });
}

function option(where: string, place: "query" | "path" | "body", name: string, type: string | undefined, required: boolean, description = "") {
  if (type === "boolean" && place === "path") fail(`${where} has the path parameter ${name} of type boolean, which the CLI can't pass yet.`);
  if (type !== "integer" && type !== "string" && type !== "boolean" && type !== "strings") fail(`${where} has the parameter ${name} of type ${type}, which the CLI can't pass yet.`);
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
