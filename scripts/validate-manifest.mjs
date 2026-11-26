import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import YAML from "yaml";
import { runsOnAtlassianIssues } from "./eligibility.mjs";

const schema = JSON.parse(readFileSync("node_modules/@forge/manifest/out/schema/manifest-schema.json", "utf8"));
const manifest = YAML.parse(readFileSync("manifest.yml", "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const ok = validate(manifest);
console.log(ok ? "MANIFEST OK" : "MANIFEST ERRORS");
if (!ok) for (const e of validate.errors) console.log(`- ${e.instancePath || "/"} ${e.message} ${JSON.stringify(e.params)}`);

// "Runs on Atlassian" pre-flight: no egress anywhere (see scripts/eligibility.mjs).
const sources = listFiles("src")
  .filter((p) => /\.(ts|tsx|js|mjs)$/.test(p))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));
const issues = runsOnAtlassianIssues(manifest, sources);
console.log(issues.length === 0 ? "RUNS ON ATLASSIAN OK (no egress)" : "RUNS ON ATLASSIAN AT RISK");
for (const issue of issues) console.log(`- ${issue}`);

process.exit(ok && issues.length === 0 ? 0 : 1);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}
