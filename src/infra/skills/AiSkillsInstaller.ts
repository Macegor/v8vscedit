import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProcess } from '../process';
import { Logger } from '../support/Logger';

export const AI_SKILLS_REPOSITORY_URL = 'https://github.com/Nikolay-Shirokov/cc-1c-skills.git';

export type AiSkillsRuntime = 'python' | 'powershell';

export interface AiSkillsPlatform {
  readonly id: string;
  readonly label: string;
  readonly targetPrefix: string;
}

export const AI_SKILLS_PLATFORMS: readonly AiSkillsPlatform[] = [
  { id: 'claude-code', label: 'Claude Code', targetPrefix: '.claude/skills' },
  { id: 'augment', label: 'Augment', targetPrefix: '.augment/skills' },
  { id: 'cline', label: 'Cline', targetPrefix: '.cline/skills' },
  { id: 'cursor', label: 'Cursor', targetPrefix: '.cursor/skills' },
  { id: 'copilot', label: 'GitHub Copilot', targetPrefix: '.github/skills' },
  { id: 'kilo', label: 'Kilo Code', targetPrefix: '.kilocode/skills' },
  { id: 'kiro', label: 'Kiro', targetPrefix: '.kiro/skills' },
  { id: 'codex', label: 'Codex', targetPrefix: '.codex/skills' },
  { id: 'gemini', label: 'Gemini CLI', targetPrefix: '.gemini/skills' },
  { id: 'opencode', label: 'OpenCode', targetPrefix: '.opencode/skills' },
  { id: 'roo', label: 'Roo Code', targetPrefix: '.roo/skills' },
  { id: 'windsurf', label: 'Windsurf', targetPrefix: '.windsurf/skills' },
  { id: 'agents', label: 'Agent Skills', targetPrefix: '.agents/skills' },
] as const;

export interface AiSkillsInstallOptions {
  readonly projectRoot: string;
  readonly platform: AiSkillsPlatform;
  readonly runtime: AiSkillsRuntime;
  readonly repositoryUrl?: string;
}

export interface AiSkillsInstallResult {
  readonly installedCount: number;
  readonly targetDir: string;
  readonly targetPrefix: string;
  readonly info: readonly string[];
  readonly warnings: readonly string[];
}

type SkillRuntime = 'ps' | 'py' | 'both' | 'none';

const SOURCE_PREFIX = '.claude/skills';
const RX_PS = /powershell\.exe\s+(?:-NoProfile\s+)?-File\s+(.+?)\.ps1/g;
const RX_PY = /python\s+('?[\w./_-]+?)\.py/g;

/**
 * Устанавливает скилы 1С из внешнего репозитория в каталог выбранной AI-платформы.
 * Сервис повторяет файловую логику `scripts/switch.py`, но не требует запускать Python.
 */
export class AiSkillsInstaller {
  constructor(private readonly logger: Logger) {}

  async installFromRepository(options: AiSkillsInstallOptions): Promise<AiSkillsInstallResult> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-ai-skills-'));
    const repoDir = path.join(tempRoot, 'cc-1c-skills');

    try {
      await this.cloneRepository(options.repositoryUrl ?? AI_SKILLS_REPOSITORY_URL, repoDir);
      return this.installFromLocalRepository(repoDir, options);
    } finally {
      this.removeTempDir(tempRoot);
    }
  }

  installFromLocalRepository(
    repositoryRoot: string,
    options: Omit<AiSkillsInstallOptions, 'repositoryUrl'>
  ): AiSkillsInstallResult {
    const srcDir = path.join(repositoryRoot, '.claude', 'skills');
    const skills = scanSkills(srcDir);
    if (skills.length === 0) {
      throw new Error(`Скилы не найдены в ${srcDir}`);
    }

    const targetDir = path.join(options.projectRoot, ...options.platform.targetPrefix.split('/'));
    if (fs.existsSync(targetDir)) {
      const existing = scanSkills(targetDir);
      if (existing.length > 0) {
        this.logger.appendLine(`[ai-skills] В ${options.platform.targetPrefix}/ уже есть ${existing.length} скилов. Обновляю.`);
      }
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    copyRootFiles(srcDir, targetDir);

    const info: string[] = [];
    const warnings: string[] = [];
    let installedCount = 0;

    this.logger.appendLine(`[ai-skills] Копирование ${skills.length} скилов в ${options.platform.targetPrefix}/`);
    for (const skillName of skills) {
      const srcSkill = path.join(srcDir, skillName);
      const dstSkill = path.join(targetDir, skillName);
      const sourceRuntime = classifySkillRuntime(srcSkill);
      const missing = checkMissingFiles(srcSkill, options.runtime, repositoryRoot);
      const skipRuntime = shouldSkipRuntimeSwitch(sourceRuntime, options.runtime, missing);

      copyDirectory(srcSkill, dstSkill);
      for (const mdPath of collectMdFiles(dstSkill)) {
        const content = fs.readFileSync(mdPath, 'utf-8');
        let next = rewritePaths(content, SOURCE_PREFIX, options.platform.targetPrefix);
        if (!skipRuntime) {
          next = switchRuntimeContent(next, options.runtime);
        }
        if (next !== content) {
          fs.writeFileSync(mdPath, next, 'utf-8');
        }
      }

      const messages = collectRuntimeMessages(skillName, srcSkill, options.runtime, repositoryRoot);
      info.push(...messages.info);
      warnings.push(...messages.warnings);
      this.logger.appendLine(`[ai-skills] [OK] ${skillName}`);
      installedCount += 1;
    }

    return {
      installedCount,
      targetDir,
      targetPrefix: options.platform.targetPrefix,
      info,
      warnings,
    };
  }

  private async cloneRepository(repositoryUrl: string, targetDir: string): Promise<void> {
    this.logger.appendLine(`[ai-skills] Клонирование ${repositoryUrl}`);
    const result = await runProcess({
      command: 'git',
      args: ['clone', '--depth', '1', repositoryUrl, targetDir],
      shell: false,
      onStdout: (chunk) => this.appendGitOutput(chunk),
      onStderr: (chunk) => this.appendGitOutput(chunk),
    });

    if (result.exitCode !== 0) {
      const details = result.lastStderr || result.lastStdout || `код завершения ${result.exitCode}`;
      throw new Error(`Не удалось клонировать репозиторий скилов: ${details}`);
    }
  }

  private appendGitOutput(chunk: Buffer): void {
    const text = chunk.toString('utf-8').trim();
    if (text.length > 0) {
      this.logger.appendLine(`[ai-skills][git] ${text}`);
    }
  }

  private removeTempDir(tempRoot: string): void {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[ai-skills][warn] Не удалось удалить временный каталог ${tempRoot}: ${message}`);
    }
  }
}

function scanSkills(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  return fs.readdirSync(skillsDir)
    .filter((entry) => {
      const skillPath = path.join(skillsDir, entry);
      return fs.statSync(skillPath).isDirectory() && fs.existsSync(path.join(skillPath, 'SKILL.md'));
    })
    .sort((left, right) => left.localeCompare(right));
}

function collectMdFiles(skillDir: string): string[] {
  return fs.readdirSync(skillDir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => path.join(skillDir, name))
    .sort((left, right) => left.localeCompare(right));
}

function classifySkillRuntime(skillDir: string): SkillRuntime {
  let hasPs = false;
  let hasPy = false;

  for (const mdPath of collectMdFiles(skillDir)) {
    const content = fs.readFileSync(mdPath, 'utf-8');
    hasPs = hasPs || containsPsInvocation(content);
    hasPy = hasPy || containsPyInvocation(content);
    if (hasPs && hasPy) {
      return 'both';
    }
  }

  if (hasPs) {
    return 'ps';
  }
  if (hasPy) {
    return 'py';
  }
  return 'none';
}

function containsPsInvocation(content: string): boolean {
  RX_PS.lastIndex = 0;
  return RX_PS.test(content);
}

function containsPyInvocation(content: string): boolean {
  RX_PY.lastIndex = 0;
  return RX_PY.test(content);
}

function checkMissingFiles(skillDir: string, targetRuntime: AiSkillsRuntime, root: string): string[] {
  const missing: string[] = [];

  for (const mdPath of collectMdFiles(skillDir)) {
    const content = fs.readFileSync(mdPath, 'utf-8');
    if (targetRuntime === 'python') {
      RX_PS.lastIndex = 0;
      for (const match of content.matchAll(RX_PS)) {
        const pyPath = `${match[1].replace(/^'/, '')}.py`;
        if (!fs.existsSync(path.join(root, pyPath))) {
          missing.push(pyPath);
        }
      }
      continue;
    }

    RX_PY.lastIndex = 0;
    for (const match of content.matchAll(RX_PY)) {
      const psPath = `${match[1].replace(/^'/, '')}.ps1`;
      if (!fs.existsSync(path.join(root, psPath))) {
        missing.push(psPath);
      }
    }
  }

  return missing;
}

function shouldSkipRuntimeSwitch(
  sourceRuntime: SkillRuntime,
  targetRuntime: AiSkillsRuntime,
  missing: readonly string[]
): boolean {
  if (missing.length === 0) {
    return false;
  }

  return (targetRuntime === 'python' && (sourceRuntime === 'ps' || sourceRuntime === 'none'))
    || (targetRuntime === 'powershell' && (sourceRuntime === 'py' || sourceRuntime === 'none'));
}

function rewritePaths(content: string, sourcePrefix: string, targetPrefix: string): string {
  return content.split(`${sourcePrefix}/`).join(`${targetPrefix}/`);
}

function switchRuntimeContent(content: string, targetRuntime: AiSkillsRuntime): string {
  if (targetRuntime === 'python') {
    RX_PS.lastIndex = 0;
    return content.replace(RX_PS, 'python $1.py');
  }

  RX_PY.lastIndex = 0;
  return content.replace(RX_PY, 'powershell.exe -NoProfile -File $1.ps1');
}

function collectRuntimeMessages(
  skillName: string,
  skillDir: string,
  targetRuntime: AiSkillsRuntime,
  root: string
): { readonly info: string[]; readonly warnings: string[] } {
  const info: string[] = [];
  const warnings: string[] = [];
  const sourceRuntime = classifySkillRuntime(skillDir);

  if (targetRuntime === 'python' && (sourceRuntime === 'ps' || sourceRuntime === 'none')) {
    const missing = checkMissingFiles(skillDir, 'python', root);
    if (missing.length > 0) {
      info.push(`${skillName} — только PowerShell (Python-версия не предусмотрена)`);
    }
    return { info, warnings };
  }

  if (targetRuntime === 'powershell' && (sourceRuntime === 'py' || sourceRuntime === 'none')) {
    const missing = checkMissingFiles(skillDir, 'powershell', root);
    if (missing.length > 0) {
      info.push(`${skillName} — только Python (PowerShell-версия не предусмотрена)`);
    }
    return { info, warnings };
  }

  for (const missingPath of checkMissingFiles(skillDir, targetRuntime, root)) {
    warnings.push(`${missingPath} не найден (${skillName})`);
  }

  return { info, warnings };
}

function copyRootFiles(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    }
  }
}

function copyDirectory(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}
