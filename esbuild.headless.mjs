import esbuild from "esbuild";

// Bundles the headless runner into self-contained Node scripts (luxon/yaml inlined,
// only Node builtins external). Deploy = copy dist/headless/*.cjs + a config file.
await esbuild.build({
    entryPoints: ["headless/sync.ts", "headless/authorize.ts", "headless/cli.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outdir: "dist/headless",
    outExtension: { ".js": ".cjs" },
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "info",
    sourcemap: false,
    minify: false,
});
