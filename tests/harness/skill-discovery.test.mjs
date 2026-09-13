import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const expectedSkills = ['hestia-delivery', 'hestia-refinement'];

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(target);
    return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  });
}

test('repository skills use the Codex discovery path and expose valid metadata', () => {
  const legacySkills = path.join(root, 'harness', 'skills');
  assert.equal(existsSync(legacySkills) && markdownFiles(legacySkills).some((file) => path.basename(file) === 'SKILL.md'), false,
    'Repository SKILL.md files must not remain under the non-discovered harness/skills path.');

  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  for (const name of expectedSkills) {
    const relative = `.agents/skills/${name}/SKILL.md`;
    const skill = readFileSync(path.join(root, relative), 'utf8');
    assert.match(agents, new RegExp(relative.replaceAll('/', '\\/').replaceAll('.', '\\.')),
      `AGENTS.md must route agents to ${relative}.`);
    assert.match(skill, new RegExp(`^---\\r?\\n[\\s\\S]*?^name: ${name}\\r?$`, 'm'),
      `${relative} must declare its exact skill name.`);
    assert.match(skill, /^description: \S.+$/m,
      `${relative} must include a non-empty discovery description.`);
  }
});

test('active harness Markdown links resolve after skill discovery relocation', () => {
  const activeFiles = [
    path.join(root, 'AGENTS.md'),
    path.join(root, 'CLAUDE.md'),
    path.join(root, 'CONTRIBUTING.md'),
    path.join(root, 'docs', 'delivery-governance.md'),
    ...markdownFiles(path.join(root, '.agents', 'skills'))
  ];

  for (const file of activeFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim().split('#', 1)[0];
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(href));
      assert.equal(existsSync(target), true,
        `${path.relative(root, file)} contains a broken link to ${href}.`);
    }
  }
});
