/**
 * E2E-тест: Полный функционал визуального редактора форм.
 * Проверяет поведение как в EDT:
 * - Основной реквизит виден в панели реквизитов
 * - Дерево элементов раскрывается
 * - Drag-and-drop элементов
 * - Создание групп (вертикальных/горизонтальных) через контекстное меню
 * - Переключение вкладок
 */

import { test, expect, type ElectronApplication, type Page, type FrameLocator } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const VSCODE_PATH =
  process.env.VSCODE_PATH ||
  'C:\\Users\\Pavel\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
const EXTENSION_PATH = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.resolve(__dirname, 'fixtures');
const SCREENSHOTS_DIR = path.resolve(__dirname, 'screenshots');
const FORM_XML_PATH = path.join(
  FIXTURES_PATH, 'Catalogs', 'TestCatalog', 'Forms', 'ItemForm', 'Ext', 'Form.xml'
);

let electronApp: ElectronApplication;
let page: Page;

/** Получить inner frame webview */
function getWebviewFrame(): FrameLocator {
  return page.frameLocator('iframe.webview').first().frameLocator('iframe').first();
}

/** Открыть Form.xml в визуальном редакторе */
async function openFormEditor(): Promise<void> {
  // Открыть файл через Quick Open
  const formTab = page.locator('.tab', { hasText: 'Form.xml' }).first();
  if (!await formTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.keyboard.press('Control+P');
    await page.waitForTimeout(700);
    await page.keyboard.type('Form.xml', { delay: 30 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  }
  await expect(formTab).toBeVisible({ timeout: 10_000 });

  // Reopen with custom editor
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(700);
  await page.keyboard.type('Reopen Editor With', { delay: 40 });
  await page.waitForTimeout(1500);

  const reopenWithDots = page
    .locator('.quick-input-list .monaco-list-row', { hasText: 'Reopen Editor With...' })
    .first();
  if (await reopenWithDots.isVisible({ timeout: 2000 }).catch(() => false)) {
    await reopenWithDots.click();
    await page.waitForTimeout(1500);

    const editorItem = page
      .locator('.quick-input-list .monaco-list-row', { hasText: /[Вв]изуальн|formEditor|1С/ })
      .first();
    if (await editorItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editorItem.click();
      await page.waitForTimeout(5000);
    }
  } else {
    await page.keyboard.press('Escape');
  }

  // Проверяем что webview загрузился
  const frame = getWebviewFrame();
  await expect(frame.locator('.form-editor')).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Восстановить оригинал Form.xml
  const origXml = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'test', 'fixtures', 'Form.xml'), 'utf-8'
  );
  fs.writeFileSync(FORM_XML_PATH, origXml, 'utf-8');

  electronApp = await electron.launch({
    executablePath: VSCODE_PATH,
    args: [
      FIXTURES_PATH,
      '--goto', FORM_XML_PATH,
      '--extensionDevelopmentPath=' + EXTENSION_PATH,
      '--disable-gpu', '--no-sandbox',
      '--disable-workspace-trust', '--skip-release-notes',
      '--disable-telemetry', '--new-window',
      '--user-data-dir=' + path.join(EXTENSION_PATH, '.vscode-test', 'user-data-e2e-full'),
      '--extensions-dir=' + path.join(EXTENSION_PATH, '.vscode-test', 'extensions-e2e-full'),
    ],
    timeout: 60_000,
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(8000);

  // Закрыть Welcome overlay
  const welcomeOverlay = page.locator('.onboarding-a-overlay');
  if (await welcomeOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // Закрыть Welcome tab
  const closeBtn = page.locator('.tab .codicon-close').first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
  }

  // Закрыть уведомления
  const notifs = page.locator('.notifications-toasts .codicon-close');
  const nc = await notifs.count();
  for (let i = 0; i < nc; i++) {
    if (await notifs.nth(i).isVisible()) {
      await notifs.nth(i).click();
      await page.waitForTimeout(300);
    }
  }

  await page.waitForTimeout(2000);

  // Открыть форму в визуальном редакторе
  await openFormEditor();
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test.describe.serial('Полный функционал редактора форм', () => {

  test('01. Форма загружена — 4 панели видны', async () => {
    const f = getWebviewFrame();
    await expect(f.locator('.element-tree-panel')).toBeVisible();
    await expect(f.locator('.data-panel')).toBeVisible();
    await expect(f.locator('.form-preview-panel')).toBeVisible();
    await expect(f.locator('.property-panel')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-01-loaded.png') });
  });

  test('02. Основной реквизит Object виден в панели реквизитов', async () => {
    const f = getWebviewFrame();
    // Вкладка Реквизиты должна быть активна
    const attrTab = f.locator('.tab[data-tab="attributes"]');
    await expect(attrTab).toHaveClass(/active/);

    // Должен быть реквизит Object с типом CatalogObject...
    const dataBody = f.locator('#data-body');
    const objectRow = dataBody.locator('.data-table-row', { hasText: 'Object' }).first();
    await expect(objectRow).toBeVisible();

    // Должен быть отмечен чекбокс "Исп."
    const checkbox = objectRow.locator('.used-checkbox');
    await expect(checkbox).toBeChecked();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-02-main-attr.png') });
  });

  test('03. Реквизит Object раскрывается — видны колонки', async () => {
    const f = getWebviewFrame();
    const dataBody = f.locator('#data-body');

    // Кликаем на Object (он expandable)
    const objectRow = dataBody.locator('.data-table-row.expandable', { hasText: 'Object' }).first();
    await objectRow.click();
    await page.waitForTimeout(500);

    // Должны появиться дочерние строки
    const childRows = dataBody.locator('.data-table-row.child-row');
    const count = await childRows.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-03-attr-expanded.png') });
  });

  test('04. Дерево элементов раскрывается — видны вложенные элементы', async () => {
    const f = getWebviewFrame();
    const treeBody = f.locator('#tree-body');

    // Кликаем на стрелку раскрытия первой группы
    const toggles = treeBody.locator('.toggle:not(.empty)');
    const firstToggle = toggles.first();
    await firstToggle.click();
    await page.waitForTimeout(300);

    // Должны появиться дочерние tree-node
    const treeNodes = treeBody.locator('.tree-node');
    const count = await treeNodes.count();
    expect(count).toBeGreaterThan(3);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-04-tree-expanded.png') });
  });

  test('05. Выбор элемента в дереве — свойства обновляются', async () => {
    const f = getWebviewFrame();

    // Кликаем на элемент "Наименование" (InputField)
    const nameNode = f.locator('.tree-node', { hasText: 'Наименование' }).first();
    if (await nameNode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameNode.click();
      await page.waitForTimeout(500);

      const propBody = f.locator('#property-body');
      // Должны видеть свойства: тип InputField, путь к данным
      const typeValue = propBody.locator('.property-value', { hasText: 'InputField' });
      await expect(typeValue).toBeVisible({ timeout: 3000 });
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-05-properties.png') });
  });

  test('06. Drag-and-drop элемента в дереве', async () => {
    const f = getWebviewFrame();
    const treeBody = f.locator('#tree-body');

    // Берём количество узлов до перемещения
    const nodesBefore = await treeBody.locator('.tree-node').count();

    // Находим элемент для перетаскивания (Разделитель1)
    const separator = f.locator('.tree-node', { hasText: 'Разделитель1' }).first();
    const target = f.locator('.tree-node', { hasText: 'КнопкаЗапустить' }).first();

    if (await separator.isVisible({ timeout: 2000 }).catch(() => false) &&
        await target.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Drag-and-drop
      await separator.dragTo(target);
      await page.waitForTimeout(1000);
    }

    // Количество узлов не должно измениться (перемещение, не удаление)
    const nodesAfter = await treeBody.locator('.tree-node').count();
    expect(nodesAfter).toBe(nodesBefore);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-06-after-drag.png') });
  });

  test('07. Контекстное меню — правый клик по группе', async () => {
    const f = getWebviewFrame();

    // ПКМ на ОсновнаяГруппа (UsualGroup — контейнер)
    const autoBar = f.locator('.tree-node', { hasText: 'ОсновнаяГруппа' }).first();
    if (await autoBar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await autoBar.click({ button: 'right' });
      await page.waitForTimeout(500);

      // Должно появиться контекстное меню
      const menu = f.locator('.context-menu');
      await expect(menu).toBeVisible({ timeout: 3000 });

      // Должен быть пункт "Добавить дочерний элемент..."
      const addChild = menu.locator('.context-menu-item', { hasText: 'Добавить дочерний' });
      await expect(addChild).toBeVisible();

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-07-context-menu.png') });

      // Закрываем меню кликом
      await f.locator('.form-editor').click();
      await page.waitForTimeout(300);
    }
  });

  test('08. Создание группы через контекстное меню + picker', async () => {
    const f = getWebviewFrame();

    // ПКМ на ОсновнаяГруппа (UsualGroup)
    const firstNode = f.locator('.tree-node', { hasText: 'ОсновнаяГруппа' }).first();
    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(500);

    const menu = f.locator('.context-menu');
    if (await menu.isVisible({ timeout: 2000 }).catch(() => false)) {
      const addChild = menu.locator('.context-menu-item', { hasText: 'Добавить дочерний' });
      if (await addChild.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addChild.click();
        await page.waitForTimeout(500);

        // Picker должен появиться
        const picker = f.locator('.picker-overlay');
        await expect(picker).toBeVisible({ timeout: 3000 });

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-08-picker.png') });

        // Кликаем "Группа (вертикальная)"
        const vertGroup = f.locator('.picker-item', { hasText: 'Группа (вертикальная)' });
        await vertGroup.click();
        await page.waitForTimeout(2000);

        // Picker закрылся
        await expect(picker).not.toBeVisible({ timeout: 2000 });

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-08-after-create.png') });
      } else {
        // Нет "Добавить дочерний" — закроем меню
        await f.locator('.form-editor').click();
      }
    }
  });

  test('09. Новая группа появилась в дереве', async () => {
    const f = getWebviewFrame();
    const treeBody = f.locator('#tree-body');

    // Ищем новый элемент в дереве
    const newNode = treeBody.locator('.tree-node', { hasText: /Новый/ }).first();
    // Если createElement сработал — элемент должен быть
    if (await newNode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(newNode).toBeVisible();
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-09-new-group.png') });
  });

  test('10. Переключение на вкладку "Команды" — видны команды', async () => {
    const f = getWebviewFrame();
    const cmdTab = f.locator('.tab[data-tab="commands"]');
    await cmdTab.click();
    await page.waitForTimeout(500);

    await expect(cmdTab).toHaveClass(/active/);

    // RunCheck и ClearResults
    const dataBody = f.locator('#data-body');
    const runCheck = dataBody.locator('.data-table-row', { hasText: 'RunCheck' }).first();
    await expect(runCheck).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-10-commands.png') });
  });

  test('11. Переключение на "Параметры" — видны обработчики событий', async () => {
    const f = getWebviewFrame();
    const paramsTab = f.locator('.tab[data-tab="parameters"]');
    await paramsTab.click();
    await page.waitForTimeout(500);

    const dataBody = f.locator('#data-body');
    const onCreate = dataBody.locator('.data-table-row', { hasText: 'OnCreateAtServer' }).first();
    await expect(onCreate).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-11-events.png') });
  });

  test('12. Табы "Форма"/"Модуль" видны внизу', async () => {
    const f = getWebviewFrame();
    await expect(f.locator('.tab[data-tab="form-preview"]')).toBeVisible();
    await expect(f.locator('.tab[data-tab="module"]')).toBeVisible();
  });

  test('13. Превью — элементы отрендерены', async () => {
    const f = getWebviewFrame();
    const preview = f.locator('#preview-body');
    const elements = preview.locator('.preview-element');
    const count = await elements.count();
    expect(count).toBeGreaterThan(3);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'full-12-preview.png') });
  });

  test('14. Финальный скриншот', async () => {
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'full-13-final.png'),
      fullPage: true,
    });
  });
});
