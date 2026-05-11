/**
 * E2E-тест: Layout и панель данных визуального редактора форм.
 * Playwright + Electron: VS Code с расширением v8vscedit.
 *
 * Проверяет:
 * - 2x2 grid layout (4 панели)
 * - Дерево элементов формы
 * - Панель реквизитов / команд / параметров
 * - Превью формы
 * - Панель свойств
 * - Переключение вкладок
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
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
  FIXTURES_PATH,
  'Catalogs',
  'TestCatalog',
  'Forms',
  'ItemForm',
  'Ext',
  'Form.xml'
);

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  electronApp = await electron.launch({
    executablePath: VSCODE_PATH,
    args: [
      // Открываем папку fixtures чтобы File Explorer видел файлы
      FIXTURES_PATH,
      // И сразу открываем Form.xml
      '--goto', FORM_XML_PATH,
      '--extensionDevelopmentPath=' + EXTENSION_PATH,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--disable-telemetry',
      '--new-window',
      '--user-data-dir=' + path.join(EXTENSION_PATH, '.vscode-test', 'user-data-e2e-form'),
      '--extensions-dir=' + path.join(EXTENSION_PATH, '.vscode-test', 'extensions-e2e-form'),
    ],
    timeout: 60_000,
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(8000);

  // Закрыть Welcome overlay если появился
  const welcomeOverlay = page.locator('.onboarding-a-overlay');
  if (await welcomeOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Нажимаем Escape чтобы закрыть Welcome
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // Закрыть Welcome tab
  const closeBtn = page.locator('.tab .codicon-close').first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
  }

  // Закрыть уведомления
  const closeBtns = page.locator('.notifications-toasts .codicon-close');
  const notifCount = await closeBtns.count();
  for (let i = 0; i < notifCount; i++) {
    if (await closeBtns.nth(i).isVisible()) {
      await closeBtns.nth(i).click();
      await page.waitForTimeout(300);
    }
  }

  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test.describe.serial('Визуальный редактор форм — layout и панели', () => {
  test('01. Form.xml фикстура существует', async () => {
    expect(fs.existsSync(FORM_XML_PATH)).toBe(true);
  });

  test('02. Form.xml открыт и переоткрываем в визуальном редакторе', async () => {
    // Проверяем что таб Form.xml виден
    const formTab = page.locator('.tab', { hasText: 'Form.xml' }).first();
    if (!await formTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Файл не открылся автоматически — откроем через Quick Open (Ctrl+P)
      await page.keyboard.press('Control+P');
      await page.waitForTimeout(700);
      await page.keyboard.type('Form.xml', { delay: 30 });
      await page.waitForTimeout(1500);
      // Выбираем первый результат
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }

    // Ждём что таб Form.xml появился
    await expect(formTab).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-01-text-opened.png') });

    // Reopen With — Command Palette (Ctrl+Shift+P уже ставит >)
    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(700);

    await page.keyboard.type('Reopen Editor With', { delay: 40 });
    await page.waitForTimeout(1500);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-01-cmd-palette.png') });

    // Выбираем "Reopen Editor With..." (с тремя точками — открывает picker)
    const reopenWithDots = page
      .locator('.quick-input-list .monaco-list-row', { hasText: 'Reopen Editor With...' })
      .first();
    if (await reopenWithDots.isVisible({ timeout: 2000 }).catch(() => false)) {
      await reopenWithDots.click();
    } else {
      // Fallback: второй элемент
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);

    // Делаем скриншот списка редакторов
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-01-reopen-list.png') });

    // Ищем наш custom editor в списке
    const editorItems = page.locator('.quick-input-list .monaco-list-row');
    const count = await editorItems.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const text = await editorItems.nth(i).textContent() ?? '';
      if (
        text.includes('изуальн') ||
        text.includes('formEditor') ||
        text.includes('1С') ||
        text.includes('v8vscedit')
      ) {
        await editorItems.nth(i).click();
        found = true;
        await page.waitForTimeout(5000);
        break;
      }
    }

    if (!found) {
      await page.keyboard.press('Escape');
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-01-opened.png') });
  });

  test('03. Webview загружен — видна структура form-editor', async () => {
    // Ищем iframe webview
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    // Проверяем наличие корневого контейнера
    const formEditor = innerFrame.locator('.form-editor');
    await expect(formEditor).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-02-webview.png') });
  });

  test('04. 2x2 grid: 4 панели видны', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    // Дерево элементов (top-left)
    const treePanel = innerFrame.locator('.element-tree-panel');
    await expect(treePanel).toBeVisible({ timeout: 5000 });

    // Панель данных (top-right)
    const dataPanel = innerFrame.locator('.data-panel');
    await expect(dataPanel).toBeVisible({ timeout: 5000 });

    // Превью (bottom-left)
    const previewPanel = innerFrame.locator('.form-preview-panel');
    await expect(previewPanel).toBeVisible({ timeout: 5000 });

    // Свойства (bottom-right)
    const propertyPanel = innerFrame.locator('.property-panel');
    await expect(propertyPanel).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-03-4panels.png') });
  });

  test('05. Дерево элементов — корневые элементы видны', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const treeBody = innerFrame.locator('#tree-body');
    await expect(treeBody).toBeVisible({ timeout: 5000 });

    // Должны быть узлы дерева
    const treeNodes = innerFrame.locator('.tree-node');
    const count = await treeNodes.count();
    expect(count).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-04-tree.png') });
  });

  test('06. Табы дерева элементов — "Элементы" и "Командный интерфейс"', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const elementsTab = innerFrame.locator('.tab[data-tab="elements"]');
    await expect(elementsTab).toBeVisible({ timeout: 5000 });
    await expect(elementsTab).toHaveClass(/active/);

    const ciTab = innerFrame.locator('.tab[data-tab="command-interface"]');
    await expect(ciTab).toBeVisible({ timeout: 5000 });
  });

  test('07. Панель данных — вкладка "Реквизиты" активна по умолчанию', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const attrTab = innerFrame.locator('.tab[data-tab="attributes"]');
    await expect(attrTab).toBeVisible({ timeout: 5000 });
    await expect(attrTab).toHaveClass(/active/);

    // Должны быть строки таблицы реквизитов
    const dataBody = innerFrame.locator('#data-body');
    await expect(dataBody).toBeVisible({ timeout: 5000 });

    const headerRow = innerFrame.locator('.data-table-header');
    await expect(headerRow).toBeVisible({ timeout: 5000 });

    // Реквизиты из фикстуры: Object, ScheduleSelector, RunsInBackgroundOnSchedule
    const rows = innerFrame.locator('.data-table-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(3);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-05-attributes.png') });
  });

  test('08. Переключение на вкладку "Команды"', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const cmdTab = innerFrame.locator('.tab[data-tab="commands"]');
    await cmdTab.click();
    await page.waitForTimeout(500);

    await expect(cmdTab).toHaveClass(/active/);

    // Команды из фикстуры: RunCheck, ClearResults
    const rows = innerFrame.locator('.data-table-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-06-commands.png') });
  });

  test('09. Переключение на вкладку "Параметры"', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const paramsTab = innerFrame.locator('.tab[data-tab="parameters"]');
    await paramsTab.click();
    await page.waitForTimeout(500);

    await expect(paramsTab).toHaveClass(/active/);

    // События из фикстуры: OnCreateAtServer, OnOpen
    const rows = innerFrame.locator('.data-table-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-07-parameters.png') });
  });

  test('10. Возврат на вкладку "Реквизиты"', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const attrTab = innerFrame.locator('.tab[data-tab="attributes"]');
    await attrTab.click();
    await page.waitForTimeout(500);

    await expect(attrTab).toHaveClass(/active/);
  });

  test('11. Превью формы — элементы отрендерены', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const previewBody = innerFrame.locator('#preview-body');
    await expect(previewBody).toBeVisible({ timeout: 5000 });

    // Должны быть preview-element
    const previewElements = innerFrame.locator('.preview-element');
    const count = await previewElements.count();
    expect(count).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-08-preview.png') });
  });

  test('12. Клик по элементу в дереве — свойства обновляются', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    // Кликаем по первому tree-node (не root)
    const treeNodes = innerFrame.locator('.tree-node');
    const firstNode = treeNodes.first();
    await firstNode.click();
    await page.waitForTimeout(500);

    // Свойства должны появиться
    const propertyBody = innerFrame.locator('#property-body');
    const propertyGroup = propertyBody.locator('.property-group');
    const groupCount = await propertyGroup.count();
    expect(groupCount).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'form-09-properties.png') });
  });

  test('13. Табы превью — "Форма" и "Модуль" видны', async () => {
    const webviewFrame = page.frameLocator('iframe.webview').first();
    const innerFrame = webviewFrame.frameLocator('iframe').first();

    const formTab = innerFrame.locator('.tab[data-tab="form-preview"]');
    await expect(formTab).toBeVisible({ timeout: 5000 });

    const moduleTab = innerFrame.locator('.tab[data-tab="module"]');
    await expect(moduleTab).toBeVisible({ timeout: 5000 });
  });

  test('14. Финальный скриншот', async () => {
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'form-10-final.png'),
      fullPage: true,
    });
  });
});
