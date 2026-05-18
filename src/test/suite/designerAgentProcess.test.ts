import * as assert from 'assert';
import {
  buildDesignerAgentArgs,
  buildDesignerAgentModeArgs,
  type DesignerAgentInfoBaseConnection,
} from '../../infra/agent';

suite('DesignerAgentProcess', () => {
  const connection: DesignerAgentInfoBaseConnection = {
    infoBasePath: '/tmp/base',
    v8Path: '/opt/1cv8/1cv8',
  };

  test('добавляет обязательные параметры режима агента из настроек подключения', () => {
    const args = buildDesignerAgentArgs({
      connection,
      agentPort: 1543,
      agentListenAddress: '127.0.0.1',
      agentBaseDir: '/tmp/project/.v8vscedit/agent/base',
    });

    assert.deepStrictEqual(args, [
      'DESIGNER',
      '/F',
      '/tmp/base',
      '/AgentMode',
      '/AgentPort',
      '1543',
      '/AgentListenAddress',
      '127.0.0.1',
      '/AgentSSHHostKeyAuto',
      '/AgentBaseDir',
      '/tmp/project/.v8vscedit/agent/base',
    ]);
  });

  test('не дублирует параметры, явно указанные пользователем', () => {
    const args = buildDesignerAgentModeArgs({
      connection,
      agentPort: 1543,
      agentListenAddress: '127.0.0.1',
      agentBaseDir: '/tmp/default-base',
      agentModeArgs: [
        '/AgentPort',
        '1601',
        '/AgentSSHHostKey',
        '/tmp/host_id',
        '/AgentBaseDir=/tmp/manual-base',
      ],
    });

    assert.deepStrictEqual(args, [
      '/AgentListenAddress',
      '127.0.0.1',
      '/AgentPort',
      '1601',
      '/AgentSSHHostKey',
      '/tmp/host_id',
      '/AgentBaseDir=/tmp/manual-base',
    ]);
  });
});
