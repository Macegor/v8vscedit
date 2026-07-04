/**
 * Тонкий реэкспорт-барель XML-генераторов управляемой формы. Реализация
 * раздроблена на `builders/*` (God-класс #7): низовой общий модуль
 * (`formBuilderShared` — WARN_SINK/хелперы/типы), эмиттеры элементов
 * (`formElements`), реквизитов (`formAttributes`), команд (`formCommands`)
 * и сборка корневого `Form.xml` (`formDocument`). Публичный API сохранён
 * байт-в-байт: потребители (FormAddService/FormEditService/FormCompileService)
 * импортируют символы отсюда как раньше.
 *
 * Порт логики из `.claude/skills/form-compile/scripts/form-compile.py`
 * (функции `emit_*`). Целиком детерминированные функции — состояния нет,
 * ID берутся из IdAllocator.
 */
import type { ElementEventPatch, FormEventPatch } from './types';

export { buildFormXmlFromDefinition } from './builders/formDocument';
export { emitElement, buildElementXml } from './builders/formElements';
export type { EmitContext } from './builders/formBuilderShared';
export { KNOWN_FORM_EVENTS, withCollectedWarnings } from './builders/formBuilderShared';
export { buildAttributeXml } from './builders/formAttributes';
export { buildCommandXml } from './builders/formCommands';
export type { IdAllocator } from './FormShared';

// сохраняем прежние реэкспорты типов для обратной совместимости потребителей
export type { FormEventPatch, ElementEventPatch };
