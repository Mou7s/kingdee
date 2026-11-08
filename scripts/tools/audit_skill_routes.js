// Local structure and static routing checks; never connects to a ledger.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dir, '../..');
const base = join(root, '.agents/skills');
let failures = 0;
for (const name of readdirSync(base).filter(n => existsSync(join(base, n, 'SKILL.md')))) {
  const dir = join(base, name);
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'audit_skills.js'), dir]);
  process.stdout.write(result.stdout);
  if (result.exitCode) failures++;
  // Only explicit cross-skill paths: legacy prose snippets are not executable links.
  function scan(d) {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, ent.name);
      if (ent.isDirectory()) scan(path);
      else if (ent.name.endsWith('.md')) {
        const text = readFileSync(path, 'utf8');
        for (const m of text.matchAll(/\.\.\/kingdee-[\w-]+\/(?:references\/[\w./-]+\.md|SKILL\.md)/g)) {
          if (!existsSync(resolve(dir, m[0]))) { console.error('失效跨技能引用', path, m[0]); failures++; }
        }
      }
    }
  }
  scan(dir);
}
const scenarios = [
  ['普通查单', 'kingdee-k3cloud', ['search-bill.md', '真实 FID/FEntryID']],
  ['晶圆配对建料', 'kingdee-materials-bom', ['material-scope-invariants.md', '蓝膜 BOM', '黑胶', '单芯']],
  ['跨月应付', 'kingdee-finance', ['FSETACCOUNTTYPE', '只能保存草稿', 'reconciliation-xlsx-ap-query.md']],
  ['客户解冻', 'kingdee-sales-inventory', ['customer-unfreeze-by-name.md', '唯一对象', '独立复查']],
  ['角色权限', 'kingdee-system-admin', ['SEC_User', 'NeedUpDateFields=[]', '实际验证']],
];
for (const [label, name, required] of scenarios) {
  const text = readFileSync(join(base, name, 'SKILL.md'), 'utf8');
  const missing = required.filter(s => !text.includes(s));
  if (missing.length) { failures++; console.error(label, '缺少', missing); }
  else console.log('静态选路通过:', label, '→', name);
}
console.log('静态检查不代表生产业务验证；失败数:', failures);
process.exitCode = failures ? 1 : 0;
