import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const audit = join(import.meta.dir, "../tools/audit_skills.js");
function run({ name = "sample-skill", desc = "description: Checks sample data when requested.", body = "", refs = {} } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "skill-audit-"));
  const dir = join(temp, "sample-skill");
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n${desc}\n---\n${body}\n`);
    for (const [path, text] of Object.entries(refs)) {
      const target = join(dir, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, text);
    }
    const result = Bun.spawnSync([process.execPath, audit, dir]);
    return { code: result.exitCode, output: result.stdout.toString() };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test("合法技能及完整路径入口通过", () => {
  expect(run({ body: "`references/a.md`", refs: { "references/a.md": "# A\n" } }).code).toBe(0);
});
for (const desc of ["", "description:", "description: >-", 'description: ""', "description: ''", "description: null"]) {
  test(`拒绝缺失或空描述 ${JSON.stringify(desc)}`, () => {
    const result = run({ desc });
    expect(result.code).toBe(1);
    expect(result.output).toContain("description 缺失或为空");
  });
}
test("拒绝非法名称", () => expect(run({ name: "Bad_Name" }).code).toBe(1));
test("拒绝目录与名称不一致", () => expect(run({ name: "other-skill" }).output).toContain("name 与目录名不一致"));
test("拒绝不存在的完整路径", () => expect(run({ body: "`references/missing.md`" }).output).toContain("引用不存在"));
test("同名文件不能掩盖漏索引", () => {
  const result = run({ body: "`references/a.md`", refs: { "references/a.md": "# A", "references/playbook/a.md": "# B" } });
  expect(result.code).toBe(1);
  expect(result.output).toContain("references/playbook/a.md");
});
test("无二级标题的长参考文件也须目录", () => {
  const result = run({ body: "`references/a.md`", refs: { "references/a.md": "# A\n" + "内容\n".repeat(101) } });
  expect(result.output).toContain("长 reference 缺目录");
});
test("长参考文件有目录通过", () => {
  expect(run({ body: "`references/a.md`", refs: { "references/a.md": "# A\n## 目录\n" + "内容\n".repeat(101) } }).code).toBe(0);
});
test("拒绝过长描述", () => expect(run({ desc: "description: " + "a".repeat(1025) }).code).toBe(1));
