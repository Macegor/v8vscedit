<template>
  <div class="layout">
    <div class="workspace">
      <div class="left-column">
        <section class="property-section">
          <h3 class="section-title">MCP расширения</h3>
          <div class="card-header">
            <span class="state" :class="state.extensionStatus.running ? 'running' : 'stopped'">
              {{ state.extensionStatus.running ? 'Запущен' : 'Остановлен' }}
            </span>
          </div>
          <div class="endpoint">{{ state.extensionStatus.endpoint || 'Endpoint не активен' }}</div>
          <div class="settings-grid compact">
            <label class="check">
              <input v-model="draft.extensionAutoStart" type="checkbox">
              <span>Автозапуск</span>
            </label>
            <label>
              Адрес
              <vscode-single-select :value="draft.extensionHost" @change="(e: Event) => draft.extensionHost = (e.target as HTMLSelectElement).value">
                <vscode-option value="127.0.0.1">127.0.0.1</vscode-option>
                <vscode-option value="localhost">localhost</vscode-option>
                <vscode-option value="::1">::1</vscode-option>
              </vscode-single-select>
            </label>
            <label>
              Порт
              <input v-model.number="draft.extensionPort" type="number" min="1" max="65535" step="1">
            </label>
          </div>
          <div class="buttons">
            <vscode-button appearance="secondary" @click="send('startExtensionMcp')">Запустить</vscode-button>
            <vscode-button appearance="secondary" @click="send('stopExtensionMcp')">Остановить</vscode-button>
          </div>
        </section>

        <section class="property-section">
          <h3 class="section-title">MCP bsl-analyzer</h3>
          <div class="card-header">
            <span class="state" :class="bslAnyRunning ? 'running' : 'stopped'">
              {{ bslAnyRunning ? 'Запущен' : 'Остановлен' }}
            </span>
          </div>
          <div class="checks">
            <label class="check">
              <input v-model="draft.bslAnalyzerAutoStart" type="checkbox">
              <span>Автозапуск</span>
            </label>
            <label class="check">
              <input v-model="draft.bslAnalyzerReferenceEnabled" type="checkbox">
              <span>reference</span>
            </label>
            <label class="check">
              <input v-model="draft.bslAnalyzerWorkspaceEnabled" type="checkbox">
              <span>workspace</span>
            </label>
          </div>
          <div class="profile-list">
            <div v-for="profile in state.bslAnalyzerStatus.profiles" :key="profile.profile" class="profile">
              <div>
                <strong>{{ profile.profile }}</strong>
                <span class="profile-state" :class="profile.running ? 'running' : 'stopped'">
                  {{ profile.running ? `pid ${profile.pid}` : profile.enabled ? 'готов к запуску' : 'отключён' }}
                </span>
              </div>
              <code>{{ profile.commandLine }}</code>
              <div v-if="profile.lastError" class="error">{{ profile.lastError }}</div>
            </div>
          </div>
          <div class="buttons">
            <vscode-button appearance="secondary" @click="send('startBslAnalyzerMcp')">Запустить профили</vscode-button>
            <vscode-button appearance="secondary" @click="send('stopBslAnalyzerMcp')">Остановить профили</vscode-button>
          </div>
          <div class="settings-block">
            <h4>Параметры запуска</h4>
            <label>
              source-dir
              <vscode-textfield :value="draft.bslAnalyzerWorkspaceSourceDir" autocomplete="off" spellcheck="false" @input="(e: Event) => draft.bslAnalyzerWorkspaceSourceDir = (e.target as HTMLInputElement).value" />
            </label>
            <div class="settings-grid two">
              <label>
                EMBEDDING_URL
                <vscode-textfield :value="draft.bslAnalyzerEmbeddingUrl" autocomplete="off" spellcheck="false" @input="(e: Event) => draft.bslAnalyzerEmbeddingUrl = (e.target as HTMLInputElement).value" />
              </label>
              <label>
                EMBEDDING_MODEL
                <vscode-textfield :value="draft.bslAnalyzerEmbeddingModel" autocomplete="off" spellcheck="false" @input="(e: Event) => draft.bslAnalyzerEmbeddingModel = (e.target as HTMLInputElement).value" />
              </label>
            </div>
            <label>
              EMBEDDING_API_KEY
              <input v-model="draft.bslAnalyzerEmbeddingApiKey" type="password" autocomplete="off" spellcheck="false">
            </label>
            <label>
              NAPARNIK_TOKEN
              <input v-model="draft.bslAnalyzerNaparnikToken" type="password" autocomplete="off" spellcheck="false">
            </label>
          </div>
          <div class="settings-block">
            <h4>Live-подключение 1С</h4>
            <label>
              onec-url
              <vscode-textfield :value="draft.bslAnalyzerOnecUrl" autocomplete="off" spellcheck="false" placeholder="http://localhost/base/hs/bsl-analyzer" @input="(e: Event) => draft.bslAnalyzerOnecUrl = (e.target as HTMLInputElement).value" />
            </label>
            <div class="settings-grid two">
              <label>
                Пользователь
                <vscode-textfield :value="draft.bslAnalyzerOnecUser" autocomplete="off" spellcheck="false" @input="(e: Event) => draft.bslAnalyzerOnecUser = (e.target as HTMLInputElement).value" />
              </label>
              <label>
                Пароль
                <input v-model="draft.bslAnalyzerOnecPassword" type="password" autocomplete="off" spellcheck="false">
              </label>
            </div>
          </div>
          <div class="docs">
            <a :href="state.docs.readmeUrl">Профили MCP</a>
            <a :href="state.docs.toolsUrl">Инструменты и расширение 1С</a>
          </div>
        </section>
      </div>

      <div class="right-column">
        <section class="property-section tools-card">
          <h3 class="section-title">Инструменты</h3>
          <div class="tools-summary">
            <span class="count">{{ allTools.length }}</span>
            <span>доступных инструментов</span>
          </div>
          <div class="tools-list">
            <div v-for="tool in allTools" :key="`${tool.profile}:${tool.name}:${tool.description}`" class="tool-row">
              <div class="tool-topline">
                <span class="profile-badge">{{ profileLabel(tool.profile) }}</span>
                <strong>{{ tool.name }}</strong>
              </div>
              <div class="tool-purpose">{{ tool.description }}</div>
              <div class="tool-requirement">{{ tool.requirement }}</div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div class="status" :class="[statusVisible ? 'visible' : '', statusKind]" aria-live="polite">{{ statusMessage }}</div>
    <div class="buttons footer">
      <vscode-button :disabled="saving" @click="save">{{ saving ? 'Сохранение...' : 'Сохранить' }}</vscode-button>
      <vscode-button appearance="secondary" :disabled="saving" @click="refresh">Обновить</vscode-button>
      <vscode-button appearance="secondary" :disabled="saving" @click="send('installAiSkills')">Установить скилы</vscode-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { AiMcpProfile, AiMcpSettings, AiMcpSnapshot, AiMcpUiMessage } from '@ui-shared/types/ai';

const props = defineProps<{
  initialState: AiMcpSnapshot | null;
  messageBus: MessageBus;
}>();

if (!props.initialState) {
  throw new Error('Начальное состояние MCP не передано');
}

const state = ref<AiMcpSnapshot>(props.initialState);
type MutableSettings = { -readonly [K in keyof AiMcpSettings]: AiMcpSettings[K] };
const draft = reactive<MutableSettings>({ ...props.initialState.settings });
const saving = ref(false);
const statusKind = ref<'idle' | 'success' | 'error'>('idle');
const statusMessage = ref('');
const statusVisible = computed(() => statusMessage.value.length > 0);
const bslAnyRunning = computed(() => state.value.bslAnalyzerStatus.profiles.some((profile) => profile.running));
const allTools = computed(() => [...state.value.extensionTools, ...state.value.bslAnalyzerTools]);

function save(): void {
  saving.value = true;
  setStatus('idle', 'Сохраняю настройки...');
  props.messageBus.send({ type: 'save', settings: { ...draft } });
}

function refresh(): void {
  props.messageBus.send({ type: 'refresh' });
}

function send(type: Exclude<AiMcpUiMessage['type'], 'save' | 'refresh'>): void {
  props.messageBus.send({ type });
}

function profileLabel(profile: AiMcpProfile): string {
  if (profile === 'extension') {
    return 'v8vscedit';
  }
  return profile;
}

function applyState(nextState: AiMcpSnapshot): void {
  state.value = nextState;
  Object.assign(draft, nextState.settings);
}

function setStatus(kind: 'idle' | 'success' | 'error', message: string): void {
  statusKind.value = kind;
  statusMessage.value = message;
  if (kind !== 'idle') {
    saving.value = false;
  }
}

function handleHostMessage(message: HostToUiMessage<AiMcpSnapshot>): void {
  if (message.type === 'state' || message.type === 'init') {
    applyState(message.state);
    saving.value = false;
  } else if (message.type === 'status') {
    setStatus(message.kind === 'loading' ? 'idle' : message.kind, message.message);
  } else if (message.type === 'error') {
    setStatus('error', message.message);
  }
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
  props.messageBus.on('init', handleHostMessage);
  props.messageBus.on('status', handleHostMessage);
  props.messageBus.on('error', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
  props.messageBus.off('init', handleHostMessage);
  props.messageBus.off('status', handleHostMessage);
  props.messageBus.off('error', handleHostMessage);
});
</script>

<style>
body {
  box-sizing: border-box;
  padding: 10px 12px 12px;
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(360px, 0.92fr) minmax(420px, 1.08fr);
  gap: 16px;
  align-items: start;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
}

.left-column,
.right-column {
  display: grid;
  gap: 16px;
  align-content: start;
  min-width: 0;
}

.property-section {
  position: relative;
  display: grid;
  gap: 12px;
  min-width: 0;
  box-sizing: border-box;
  margin: 10px 0 0;
  padding: 22px 16px 16px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.section-title {
  position: absolute;
  top: -12px;
  left: 14px;
  margin: 0;
  padding: 0 8px;
  background: linear-gradient(
    to bottom,
    transparent calc(50% - 1px),
    var(--vscode-sideBar-background) calc(50% - 1px),
    var(--vscode-sideBar-background) calc(50% + 1px),
    transparent calc(50% + 1px)
  );
  font-size: 17px;
  line-height: 1.25;
  font-weight: 700;
  z-index: 1;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 20px;
}

.settings-grid {
  display: grid;
  gap: 8px;
}

.settings-grid.compact {
  grid-template-columns: minmax(100px, .8fr) minmax(130px, 1.2fr) minmax(76px, .7fr);
}

.settings-grid.two {
  grid-template-columns: repeat(2, minmax(140px, 1fr));
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  color: var(--vscode-descriptionForeground);
}

.check {
  flex-direction: row;
  align-items: center;
  gap: 7px;
  color: var(--vscode-foreground);
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.settings-block {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}

.settings-block h4 {
  margin: 0;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 700;
  color: var(--vscode-foreground);
}

vscode-textfield,
vscode-single-select,
input {
  width: 100%;
  min-height: 28px;
  box-sizing: border-box;
  font: inherit;
}

input[type="checkbox"] {
  width: 15px;
  min-height: 15px;
  accent-color: var(--vscode-button-background);
}

input:not([type="checkbox"]) {
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 3px 7px;
  outline: none;
}

input:not([type="checkbox"]):focus {
  border-color: var(--vscode-focusBorder);
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.endpoint,
code,
.tool-requirement {
  color: var(--vscode-descriptionForeground);
}

code {
  display: block;
  overflow-wrap: anywhere;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
}

.state,
.profile-state,
.count {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.running {
  color: var(--vscode-testing-iconPassed);
}

.stopped {
  color: var(--vscode-descriptionForeground);
}

.profile-list,
.tools-list {
  display: grid;
  gap: 10px;
}

.profile {
  display: grid;
  gap: 4px;
}

.profile > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tools-card {
  gap: 14px;
}

.tools-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--vscode-descriptionForeground);
}

.tool-row {
  display: grid;
  grid-template-columns: minmax(170px, .9fr) minmax(260px, 1.4fr);
  gap: 4px 12px;
  align-items: start;
  min-width: 0;
  padding: 9px 0;
  border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
}

.tool-row:first-child {
  border-top: 0;
}

.tool-topline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  min-width: 0;
}

.tool-topline strong {
  overflow-wrap: anywhere;
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  line-height: 1.35;
}

.profile-badge {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  line-height: 1;
}

.tool-purpose {
  min-width: 0;
  line-height: 1.35;
}

.tool-requirement {
  grid-column: 2;
  font-size: 11px;
  line-height: 1.35;
}

.docs,
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.docs a {
  color: var(--vscode-textLink-foreground);
}

.status {
  display: none;
  min-height: 20px;
  line-height: 1.35;
}

.status.visible {
  display: block;
}

.status.success {
  color: var(--vscode-testing-iconPassed);
}

.status.error,
.error {
  color: var(--vscode-errorForeground);
}

.footer {
  position: sticky;
  bottom: 0;
  padding-top: 8px;
  background: var(--vscode-sideBar-background);
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
}

@media (max-width: 920px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .settings-grid.compact,
  .settings-grid.two,
  .tool-row {
    grid-template-columns: 1fr;
  }

  .tool-requirement {
    grid-column: auto;
  }
}
</style>
