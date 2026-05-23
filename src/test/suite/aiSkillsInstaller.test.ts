import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AI_SKILLS_PLATFORMS,
  AiSkillsInstaller,
} from '../../infra/skills/AiSkillsInstaller';

suite('AiSkillsInstaller', () => {
  test('устанавливает проектные роли Codex без скриптов внешнего репозитория', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-ai-roles-'));
    try {
      const platform = AI_SKILLS_PLATFORMS.find((item) => item.id === 'codex') ?? AI_SKILLS_PLATFORMS[0];
      const installer = new AiSkillsInstaller({ appendLine: () => undefined });
      const result = installer.installProjectRoles({
        projectRoot: root,
        platform,
      });

      const mcpRolePath = path.join(root, '.codex', 'skills', 'v8vscedit-mcp-required', 'SKILL.md');
      const content = fs.readFileSync(mcpRolePath, 'utf-8');
      assert.strictEqual(result.installedCount, 5);
      assert.ok(content.includes('v8vscedit_get_properties'));
      assert.ok(content.includes('Не запускай Python/PowerShell-скрипты'));
      assert.ok(!content.includes('github.com/Nikolay-Shirokov/cc-1c-skills'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('для Cursor пишет роли в .cursor/rules и не удаляет существующие правила', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-ai-roles-cursor-'));
    try {
      const platform = AI_SKILLS_PLATFORMS.find((item) => item.id === 'cursor') ?? AI_SKILLS_PLATFORMS[0];
      const rulesDir = path.join(root, '.cursor', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'project_rules.mdc'), 'custom rule', 'utf-8');

      const installer = new AiSkillsInstaller({ appendLine: () => undefined });
      installer.installProjectRoles({
        projectRoot: root,
        platform,
      });

      const mcpRulePath = path.join(rulesDir, 'v8vscedit-mcp-required.mdc');
      const content = fs.readFileSync(mcpRulePath, 'utf-8');
      assert.ok(content.includes('alwaysApply: true'));
      assert.ok(content.includes('v8vscedit_search_metadata'));
      assert.strictEqual(fs.readFileSync(path.join(rulesDir, 'project_rules.mdc'), 'utf-8'), 'custom rule');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('для OpenCode пишет инструкции и подключает их через opencode.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-ai-roles-opencode-'));
    try {
      const platform = AI_SKILLS_PLATFORMS.find((item) => item.id === 'opencode') ?? AI_SKILLS_PLATFORMS[0];
      fs.writeFileSync(path.join(root, 'opencode.json'), JSON.stringify({
        instructions: ['docs/project-rules.md'],
        mcp: {
          v8vscedit: {
            type: 'remote',
            url: 'http://127.0.0.1:44444/mcp',
            enabled: false,
          },
          other: {
            type: 'remote',
            url: 'https://example.com/mcp',
          },
        },
      }), 'utf-8');

      const installer = new AiSkillsInstaller({ appendLine: () => undefined });
      installer.installProjectRoles({
        projectRoot: root,
        platform,
      });

      const rolePath = path.join(root, '.opencode', 'instructions', 'v8vscedit-mcp-required.md');
      const config = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8')) as {
        instructions: string[];
        mcp: {
          v8vscedit: {
            type: string;
            url: string;
            enabled: boolean;
          };
          other: {
            type: string;
            url: string;
          };
        };
      };
      const content = fs.readFileSync(rolePath, 'utf-8');
      assert.ok(content.includes('Не редактируй XML-файлы 1С напрямую'));
      assert.ok(content.includes('Для добавления объекта или дочернего элемента используй'));
      assert.ok(config.instructions.includes('docs/project-rules.md'));
      assert.ok(config.instructions.includes('.opencode/instructions/*.md'));
      assert.strictEqual(config.mcp.v8vscedit.enabled, true);
      assert.strictEqual(config.mcp.v8vscedit.url, 'http://127.0.0.1:44444/mcp');
      assert.strictEqual(config.mcp.other.url, 'https://example.com/mcp');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('для OpenCode читает JSONC-конфиг и не теряет MCP-серверы', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-ai-roles-opencode-jsonc-'));
    try {
      const platform = AI_SKILLS_PLATFORMS.find((item) => item.id === 'opencode') ?? AI_SKILLS_PLATFORMS[0];
      fs.writeFileSync(path.join(root, 'opencode.json'), [
        '{',
        '  "$schema": "https://opencode.ai/config.json",',
        '  // существующий MCP нельзя терять',
        '  "mcp": {',
        '    "v8vscedit": {',
        '      "type": "remote",',
        '      "url": "http://127.0.0.1:38481/mcp",',
        '    },',
        '  },',
        '}',
      ].join('\n'), 'utf-8');

      const installer = new AiSkillsInstaller({ appendLine: () => undefined });
      installer.installProjectRoles({
        projectRoot: root,
        platform,
      });

      const config = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8')) as {
        instructions: string[];
        mcp: {
          v8vscedit: {
            enabled: boolean;
          };
        };
      };
      assert.ok(config.instructions.includes('.opencode/instructions/*.md'));
      assert.strictEqual(config.mcp.v8vscedit.enabled, true);
      assert.ok(!fs.existsSync(path.join(root, 'opencode.json.bak')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
