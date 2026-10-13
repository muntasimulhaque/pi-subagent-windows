import { build } from "esbuild";

const shared = {
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	sourcemap: false,
	logLevel: "warning",
};

await build({ ...shared, entryPoints: ["subagent.ts"], outfile: "dist/subagent.js" });
await build({ ...shared, entryPoints: ["supervisor.ts"], outfile: "dist/supervisor.js" });
console.log("built dist/subagent.js and dist/supervisor.js");
