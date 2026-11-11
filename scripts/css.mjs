import { build } from "esbuild";

/** Runs the real stylesheet builder, so the file in dist never drifts from what the script injects. */
export async function buildCss() {
  const result = await build({
    stdin: {
      contents: `
        import { buildCss } from "./src/core/css";
        import { builtinPresets } from "./src/core/presets";
        import { DEFAULTS } from "./src/core/config";
        export default buildCss(DEFAULTS.prefix, builtinPresets());
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
  });
  const url = "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64");
  return (await import(url)).default;
}
