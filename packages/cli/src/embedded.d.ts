declare module "*.tar.gz" {
  /** The path of the file. Inside the compiled binary, the file is embedded. */
  const path: string;
  export default path;
}
