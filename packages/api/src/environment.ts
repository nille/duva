/** The environment variable's value. Throws if the CDK app didn't set it. */
export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`The environment variable ${name} is not set`);
  return value;
}
