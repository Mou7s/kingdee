// 技能合规审计：对齐 Agent Skills 最佳实践。用法：
//   bun scripts/tools/audit_skills.js <skill-dir>       例如 .agents/skills/kingdee-k3cloud
// 全部通过 exit 0；有违规 exit 1（可用于提交前门禁）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const dir = (process.argv[2] || "").replace(/\\/g, "/").replace(/\/$/, "");
if (!dir) {
  console.error("用法: bun audit_skills.js <skill-dir>");
  process.exit(2);
}
const skillPath = join(dir, "SKILL.md");
const refDir = join(dir, "references");

function walk(d) {
  const out = [];
  let ents = [];
  try { ents = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".md")) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}
const lf = (s) => s.replace(/\r\n/g, "\n");
const skill = lf(readFileSync(skillPath, "utf8"));
const refs = walk(refDir);

const problems = [];
const report = [];

// 1. 正文行数 ≤500
const lines = skill.split("\n").length;
report.push(`SKILL.md 行数: ${lines}（上限 500）`);
if (lines > 500) problems.push(`SKILL.md 超过 500 行（${lines}）`);

// 2. description 存在且 ≤1024
const fm = skill.match(/^---\n([\s\S]*?)\n---/);
const desc = fm ? (fm[1].match(/description:[\s\S]*?(?=\n\w|$)/) || [""])[0] : "";
const name = fm?.[1].match(/^name:\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, "") || "";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) problems.push("name 必须为不超过64字符的 kebab-case");
if (name !== basename(resolve(dir))) problems.push("name 与目录名不一致");
const descLen = desc.replace(/description:\s*>?-?/, "").replace(/\s+/g, " ").trim().length;
report.push(`description 长度: ${descLen}（上限 1024）`);
if (!fm) problems.push("缺少 YAML frontmatter");
if (!descLen || /^(?:""|''|null|~)$/i.test(desc.trim().replace(/^description:\s*/, ""))) problems.push("description 缺失或为空");
if (descLen > 1024) problems.push(`description 超过 1024 字符（${descLen}）`);

// 3. 正斜杠
const back = [...refs, skillPath].filter((p) => /references\\|scripts\\|lib\\k3/.test(lf(readFileSync(p, "utf8"))));
if (back.length) problems.push(`使用反斜杠路径: ${back.length} 个文件`);
report.push(`反斜杠路径: ${back.length}`);

// 4. >100 行 reference 需有目录
const noToc = [];
for (const p of refs) {
  const t = lf(readFileSync(p, "utf8"));
  if (t.split("\n").length > 100 && !/^#{1,2} (目录|Contents)/m.test(t)) {
    noToc.push(p);
  }
}
report.push(`>100 行且缺目录的 reference: ${noToc.length}`);
if (noToc.length) problems.push(`长 reference 缺目录: ${noToc.slice(0, 5).join(", ")}${noToc.length > 5 ? " …" : ""}`);

// 5. 用完整路径检查正文入口，避免同名 reference 掩盖遗漏。
const direct = new Set();
for (const match of skill.matchAll(/references\/[A-Za-z0-9_.\/-]+\.md/g)) {
  const target = resolve(dir, match[0]);
  if (!existsSync(target)) problems.push(`引用不存在: ${match[0]}`);
  direct.add(target);
}
const deep = refs.filter((p) => !direct.has(resolve(p)));
report.push(`未从 SKILL.md 一层可达: ${deep.length}`);
if (deep.length) problems.push(`非一层可达 reference: ${deep.join(", ")}`);
// 一层可达是更强的要求；不再用文件名子串作为孤儿判断。
report.push(`完整 reference 入口: ${direct.size}`);

console.log(`审计 ${dir}  (reference ${refs.length} 个)`);
report.forEach((r) => console.log("  · " + r));
if (problems.length === 0) {
  console.log("结果: 通过 ✅");
} else {
  console.log("结果: 不合规 ❌");
  problems.forEach((p) => console.log("  ✗ " + p));
  process.exit(1);
}
