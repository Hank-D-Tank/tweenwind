import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const banner = `/*! ${pkg.name} ${pkg.version} | MIT | ${pkg.homepage || ""} */`;
const define = { __VERSION__: JSON.stringify(pkg.version) };

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// For bundlers: three entries that share one copy of the engine.
await build({
  entryPoints: { index: "src/index.ts", auto: "src/auto.ts", react: "src/react.tsx" },
  outdir: "dist",
  format: "esm",
  bundle: true,
  splitting: true,
  chunkNames: "chunk-[hash]",
  target: "es2020",
  jsx: "automatic",
  external: ["gsap", "gsap/*", "react", "react/*", "react-dom"],
  define,
  banner: { js: banner },
});

// React Server Components need the directive as the very first line of the client entry.
writeFileSync("dist/react.js", '"use client";\n' + readFileSync("dist/react.js", "utf8"));

// For a script tag: one file that brings GSAP in from the CDN by itself.
for (const minify of [false, true]) {
  await build({
    entryPoints: ["src/global.ts"],
    outfile: `dist/tweenwind${minify ? ".min" : ""}.js`,
    format: "iife",
    bundle: true,
    minify,
    target: "es2019",
    define,
    banner: { js: banner },
  });
}

// The stylesheet, for server-rendered pages that want it in the HTML head.
const { buildCss } = await import("./scripts/css.mjs");
writeFileSync("dist/tweenwind.css", banner + "\n" + (await buildCss()) + "\n");

execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { stdio: "inherit" });

// The docs site runs the real build, so it can be deployed as a plain folder.
copyFileSync("dist/tweenwind.min.js", "site/tweenwind.min.js");
if (existsSync("llms.txt")) copyFileSync("llms.txt", "site/llms.txt");

const size = (file) => {
  const bytes = readFileSync(file);
  return `${(bytes.length / 1024).toFixed(1)} kB, ${(gzipSync(bytes).length / 1024).toFixed(1)} kB gzipped`;
};
console.log("dist/tweenwind.min.js  " + size("dist/tweenwind.min.js"));
console.log("dist/tweenwind.css     " + size("dist/tweenwind.css"));
