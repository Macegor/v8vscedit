import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AI_SKILLS_PLATFORMS,
  AiSkillsInstaller,
} from '../../infra/skills/AiSkillsInstaller';

suite('AiSkillsInstaller', () => {
  test('копирует скилы, переписывает путь платформы и рантайм', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-ai-skills-'));
    try {
      const repoRoot = path.join(root, 'repo');
      const projectRoot = path.join(root, 'project');
      const sourceSkill = path.join(repoRoot, '.claude', 'skills', 'demo-skill');
      const scriptDir = path.join(repoRoot, '.claude', 'skills', 'demo-skill', 'scripts');
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(repoRoot, '.claude', 'skills', '.gitignore'), '*.tmp\n', 'utf-8');
      fs.writeFileSync(
        path.join(sourceSkill, 'SKILL.md'),
        'Run .claude/skills/demo-skill/scripts/do.ps1 with powershell.exe -NoProfile -File .claude/skills/demo-skill/scripts/do.ps1',
        'utf-8'
      );
      fs.writeFileSync(path.join(scriptDir, 'do.ps1'), 'Write-Host ok', 'utf-8');
      fs.writeFileSync(path.join(scriptDir, 'do.py'), 'print("ok")', 'utf-8');

      const installer = new AiSkillsInstaller({ appendLine: () => undefined });
      const result = installer.installFromLocalRepository(repoRoot, {
        projectRoot,
        platform: AI_SKILLS_PLATFORMS.find((item) => item.id === 'codex') ?? AI_SKILLS_PLATFORMS[0],
        runtime: 'python',
      });

      const installedSkill = path.join(projectRoot, '.codex', 'skills', 'demo-skill', 'SKILL.md');
      const content = fs.readFileSync(installedSkill, 'utf-8');
      assert.strictEqual(result.installedCount, 1);
      assert.ok(content.includes('.codex/skills/demo-skill/scripts/do.py'));
      assert.ok(content.includes('python .codex/skills/demo-skill/scripts/do.py'));
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'skills', '.gitignore')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
