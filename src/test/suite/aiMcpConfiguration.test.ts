import * as assert from 'assert';
import {
  BSL_ANALYZER_MCP_TOOLS,
  buildBslAnalyzerMcpArgs,
  buildBslAnalyzerMcpEnv,
  createDefaultAiMcpSettings,
  normalizeAiMcpSettings,
} from '../../infra/ai/AiMcpConfiguration';

suite('AiMcpConfiguration', () => {
  test('содержит инструменты обоих профилей bsl-analyzer', () => {
    const referenceTools = BSL_ANALYZER_MCP_TOOLS.filter((tool) => tool.profile === 'reference').map((tool) => tool.name);
    const workspaceTools = BSL_ANALYZER_MCP_TOOLS.filter((tool) => tool.profile === 'workspace').map((tool) => tool.name);

    assert.deepStrictEqual(referenceTools, ['search', 'syntax_help', 'its_help']);
    assert.deepStrictEqual(workspaceTools, ['metadata', 'search', 'query', 'execute', 'debug']);
  });

  test('нормализует настройки с безопасными значениями по умолчанию', () => {
    const settings = normalizeAiMcpSettings({
      extensionHost: '0.0.0.0',
      extensionPort: 0,
      bslAnalyzerWorkspaceSourceDir: '',
      bslAnalyzerEmbeddingModel: '',
    }, '/project');

    assert.strictEqual(settings.extensionAutoStart, true);
    assert.strictEqual(settings.extensionHost, '127.0.0.1');
    assert.strictEqual(settings.extensionPort, 38481);
    assert.strictEqual(settings.bslAnalyzerAutoStart, false);
    assert.strictEqual(settings.bslAnalyzerReferenceEnabled, true);
    assert.strictEqual(settings.bslAnalyzerWorkspaceEnabled, true);
    assert.strictEqual(settings.bslAnalyzerWorkspaceSourceDir, '/project');
    assert.strictEqual(settings.bslAnalyzerEmbeddingModel, 'qwen/qwen3-embedding-0.6b');
  });

  test('строит аргументы запуска workspace-профиля bsl-analyzer MCP', () => {
    const settings = {
      ...createDefaultAiMcpSettings('/project'),
      bslAnalyzerOnecUrl: 'http://localhost/base/hs/bsl-analyzer',
      bslAnalyzerOnecUser: 'admin',
      bslAnalyzerOnecPassword: 'secret',
    };

    assert.deepStrictEqual(buildBslAnalyzerMcpArgs('workspace', settings), [
      'mcp',
      'serve',
      '--profile',
      'workspace',
      '--source-dir',
      '/project',
      '--onec-url',
      'http://localhost/base/hs/bsl-analyzer',
      '--onec-user',
      'admin',
      '--onec-password',
      'secret',
    ]);
  });

  test('добавляет env только для заполненных параметров', () => {
    const env = buildBslAnalyzerMcpEnv({
      ...createDefaultAiMcpSettings('/project'),
      bslAnalyzerEmbeddingUrl: 'http://localhost:8000/v1/embeddings',
      bslAnalyzerNaparnikToken: 'token',
    }, { PATH: '/bin' });

    assert.deepStrictEqual(env, {
      PATH: '/bin',
      EMBEDDING_URL: 'http://localhost:8000/v1/embeddings',
      EMBEDDING_MODEL: 'qwen/qwen3-embedding-0.6b',
      NAPARNIK_TOKEN: 'token',
    });
  });
});
