import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BasedOnXmlService } from '../../infra/xml/BasedOnXmlService';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';
import { ExchangePlanContentService } from '../../infra/xml/ExchangePlanContentService';
import { SubsystemXmlService } from '../../infra/xml/SubsystemXmlService';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { PropertiesViewController } from '../../ui/views/properties/PropertiesViewController';
import { TypeRegistryService } from '../../ui/views/properties/TypeRegistryService';

/**
 * B2.3 — PropertiesViewController.handlePropertyChange (строка ~162) вызывает
 * `void this.handleWebviewMessage({...})` без .catch(). handleWebviewMessage —
 * async и пробрасывает исключение из enqueuePropertyOperation дальше (никакого
 * try/catch внутри самого handleWebviewMessage нет). Реальный сценарий: свойство
 * конфигурации (`isConfigurationRootNode`) редактируется, ConfigurationXmlEditor.
 * modifyConfigurationProperty делает `fs.existsSync(configXmlPath)` (true для
 * директории) и затем `fs.readFileSync(configXmlPath, 'utf-8')`, что бросает
 * EISDIR, если xmlPath указывает на директорию, а не на файл. Это исключение
 * сейчас становится необработанным (UnhandledPromiseRejection), потому что вызов
 * `void this.handleWebviewMessage(...)` в handlePropertyChange его не ловит.
 *
 * Тест фиксирует факт floating rejection через глобальный обработчик Node.js
 * `unhandledRejection` — единственный способ детерминированно перехватить именно
 * необработанное отклонение promise (а не итоговое состояние синхронного вызова).
 */
suite('PropertiesViewController — B2.3: floating rejection в handlePropertyChange', () => {
  let unhandledRejections: unknown[];
  let onUnhandledRejection: (reason: unknown) => void;

  setup(() => {
    unhandledRejections = [];
    onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
  });

  teardown(() => {
    process.off('unhandledRejection', onUnhandledRejection);
  });

  test('изменение свойства конфигурации при повреждённом xmlPath (директория вместо файла) роняет необработанный reject', async function () {
    this.timeout(5000);

    // xmlPath указывает на РЕАЛЬНО СУЩЕСТВУЮЩУЮ директорию — modifyConfigurationProperty
    // пройдёт fs.existsSync (true) и упадёт на fs.readFileSync с EISDIR.
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-b23-eisdir-'));
    const brokenXmlPath = configRoot; // директория вместо файла — гарантированный EISDIR

    const controller = new PropertiesViewController(
      new SubsystemXmlService(),
      new ExchangePlanContentService(),
      new TypeRegistryService(),
      new ConfigurationXmlEditor(),
      new BasedOnXmlService(),
      {
        refreshActiveView: () => undefined,
        replaceActiveNode: () => undefined,
      }
    );

    const node = new MetadataNode(
      {
        label: 'Конфигурация',
        nodeKind: 'configuration',
        xmlPath: brokenXmlPath,
      },
      vscode.TreeItemCollapsibleState.None
    );

    controller.buildRenderContext(node, [
      {
        key: 'Comment',
        title: 'Комментарий',
        kind: 'string',
        value: 'старое значение',
        readonly: false,
      },
    ]);

    // Публичный вызываемый путь (DynamicPanelController): изменение свойства из Vue-панели.
    controller.handlePropertyChange('Comment', 'новое значение — вызывает EISDIR при чтении');

    // Даём event loop прокрутиться, чтобы reject дошёл до глобального обработчика
    // unhandledRejection (Node.js доставляет его асинхронно, не синхронно).
    await new Promise((resolve) => setTimeout(resolve, 200));

    // КРАСНЫЙ: сейчас исключение из handleWebviewMessage долетает как
    // необработанный reject, потому что handlePropertyChange не подписывает .catch.
    // ЦЕЛЬ: handlePropertyChange обязан перехватывать ошибку (например через
    // .catch(err => outputChannel.appendLine(...))), чтобы reject не улетал наружу.
    assert.strictEqual(
      unhandledRejections.length,
      0,
      `handlePropertyChange не должен порождать необработанный reject; поймано: ${String(unhandledRejections[0])}`
    );
  });
});
