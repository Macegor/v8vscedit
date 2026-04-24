import * as fs from 'fs';
import * as path from 'path';
import { getMetaFolder, MetaKind } from '../../domain/MetaTypes';
import { getObjectLocationFromXml } from '../fs/ObjectLocation';
import { ObjectXmlReader } from './ObjectXmlReader';

type PropertyValueKind = 'string' | 'boolean' | 'localizedString';
type RootPropertyKind = 'scalar' | 'localized' | 'reference';

export interface EditResult {
  success: boolean;
  changed: boolean;
  changedFiles: string[];
  warnings: string[];
  errors: string[];
}

export class ConfigurationXmlEditor {
  private readonly objectReader = new ObjectXmlReader();

  modifyObjectProperty(
    xmlPath: string,
    options: {
      targetKind: 'Self' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue';
      targetName: string;
      tabularSectionName?: string;
      propertyKey: string;
      valueKind: PropertyValueKind;
      value: string | boolean;
    }
  ): EditResult {
    const changed = this.objectReader.updatePropertyInObject(xmlPath, options);
    return changed
      ? this.ok([xmlPath])
      : this.fail(`Не удалось изменить свойство "${options.propertyKey}".`);
  }

  modifyObjectType(
    xmlPath: string,
    options: {
      targetKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'SessionParameter' | 'CommonAttribute';
      targetName: string;
      tabularSectionName?: string;
      typeInnerXml: string;
    }
  ): EditResult {
    const changed = this.objectReader.updateTypeInObject(xmlPath, options);
    return changed ? this.ok([xmlPath]) : this.fail('Не удалось изменить тип выбранного элемента.');
  }

  modifyConfigurationProperty(
    configXmlPath: string,
    propertyName: string,
    value: string,
    kind: RootPropertyKind
  ): EditResult {
    if (!fs.existsSync(configXmlPath)) {
      return this.fail(`Не найден файл: ${configXmlPath}`);
    }
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const properties = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1];
    if (!properties) {
      return this.fail('В Configuration.xml отсутствует блок <Properties>.');
    }
    const propRe = new RegExp(`<${propertyName}>[\\s\\S]*?<\\/${propertyName}>`);
    if (!propRe.test(properties)) {
      return this.fail(`Свойство "${propertyName}" не найдено.`);
    }

    const replacement = this.buildRootPropertyBlock(propertyName, value, kind);
    const updatedProps = properties.replace(propRe, replacement);
    if (updatedProps === properties) {
      return this.warn('Значение свойства не изменилось.');
    }
    const updatedXml = xml.replace(properties, updatedProps);
    fs.writeFileSync(configXmlPath, updatedXml, 'utf-8');
    return this.ok([configXmlPath]);
  }

  addChildObject(configXmlPath: string, objectRef: string): EditResult {
    const parsed = this.parseTypeAndName(objectRef);
    if (!parsed) {
      return this.fail(`Неверный формат "${objectRef}". Ожидается "Type.Name".`);
    }
    const [type, name] = parsed;
    const folder = getMetaFolder(type as MetaKind);
    if (!folder) {
      return this.fail(`Неизвестный или неподдерживаемый тип "${type}".`);
    }
    const root = path.dirname(configXmlPath);
    const filePath = path.join(root, folder, `${name}.xml`);
    if (!fs.existsSync(filePath)) {
      return this.fail(`Файл объекта не найден: ${path.join(folder, `${name}.xml`)}`);
    }

    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const childObjects = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(xml)?.[1];
    if (childObjects === undefined) {
      return this.fail('В Configuration.xml отсутствует блок <ChildObjects>.');
    }

    const current = this.readChildEntries(childObjects);
    if (current.some((item) => item.type === type && item.name === name)) {
      return this.warn(`Объект "${objectRef}" уже включён в ChildObjects.`);
    }
    current.push({ type, name });
    current.sort((a, b) => this.sortChildObjects(a, b));
    const nextInner = this.buildChildObjectsBlock(current, this.detectIndent(childObjects, '\t\t\t'));
    const updatedXml = xml.replace(childObjects, nextInner);
    fs.writeFileSync(configXmlPath, updatedXml, 'utf-8');
    return this.ok([configXmlPath]);
  }

  removeChildObject(configXmlPath: string, objectRef: string): EditResult {
    const parsed = this.parseTypeAndName(objectRef);
    if (!parsed) {
      return this.fail(`Неверный формат "${objectRef}". Ожидается "Type.Name".`);
    }
    const [type, name] = parsed;
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const childObjects = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(xml)?.[1];
    if (childObjects === undefined) {
      return this.fail('В Configuration.xml отсутствует блок <ChildObjects>.');
    }
    const current = this.readChildEntries(childObjects);
    const next = current.filter((item) => !(item.type === type && item.name === name));
    if (next.length === current.length) {
      return this.warn(`Объект "${objectRef}" не найден в ChildObjects.`);
    }
    const nextInner = this.buildChildObjectsBlock(next, this.detectIndent(childObjects, '\t\t\t'));
    const updatedXml = xml.replace(childObjects, nextInner);
    fs.writeFileSync(configXmlPath, updatedXml, 'utf-8');
    return this.ok([configXmlPath]);
  }

  addDefaultRole(configXmlPath: string, roleName: string): EditResult {
    const roleRef = this.normalizeRoleRef(roleName);
    const updated = this.updateDefaultRoles(configXmlPath, (items) => {
      if (items.includes(roleRef)) {
        return { items, changed: false, warning: `Роль "${roleRef}" уже в списке DefaultRoles.` };
      }
      return { items: [...items, roleRef], changed: true };
    });
    return updated;
  }

  removeDefaultRole(configXmlPath: string, roleName: string): EditResult {
    const roleRef = this.normalizeRoleRef(roleName);
    const updated = this.updateDefaultRoles(configXmlPath, (items) => {
      const next = items.filter((item) => item !== roleRef);
      if (next.length === items.length) {
        return { items, changed: false, warning: `Роль "${roleRef}" отсутствует в DefaultRoles.` };
      }
      return { items: next, changed: true };
    });
    return updated;
  }

  setDefaultRoles(configXmlPath: string, roles: string[]): EditResult {
    const normalized = roles.map((r) => this.normalizeRoleRef(r));
    const updated = this.updateDefaultRoles(configXmlPath, () => ({ items: normalized, changed: true }));
    return updated;
  }

  validateRenameMetadataObject(currentXmlPath: string, childObjectTag: string, newObjectName: string): EditResult {
    if (!isValidMetadataName(newObjectName)) {
      return this.fail('Новое имя объекта имеет недопустимый формат.');
    }
    const location = getObjectLocationFromXml(currentXmlPath);
    const oldObjectName = location.objectName;
    if (oldObjectName === newObjectName) {
      return this.fail('Новое имя совпадает с текущим.');
    }
    const configXmlPath = path.join(location.configRoot, 'Configuration.xml');
    if (!fs.existsSync(configXmlPath)) {
      return this.fail(`Не найден Configuration.xml: ${configXmlPath}`);
    }
    const oldDirPath = path.join(location.configRoot, location.folderName, oldObjectName);
    const newDirPath = path.join(location.configRoot, location.folderName, newObjectName);
    const newFilePath = path.join(location.configRoot, location.folderName, `${newObjectName}.xml`);
    const isDeep = fs.existsSync(oldDirPath);
    if ((isDeep && fs.existsSync(newDirPath)) || (!isDeep && fs.existsSync(newFilePath))) {
      return this.fail(`Объект с именем "${newObjectName}" уже существует.`);
    }
    const configXml = fs.readFileSync(configXmlPath, 'utf-8');
    if (this.isObjectNameOccupiedInType(configXml, childObjectTag, oldObjectName, newObjectName)) {
      return this.fail(`Имя "${newObjectName}" уже занято для типа "${childObjectTag}".`);
    }
    return this.warn('Проверка переименования пройдена.');
  }

  renameMetadataObject(currentXmlPath: string, childObjectTag: string, newObjectName: string): EditResult {
    const validation = this.validateRenameMetadataObject(currentXmlPath, childObjectTag, newObjectName);
    if (!validation.success) {
      return validation;
    }
    const location = getObjectLocationFromXml(currentXmlPath);
    const oldObjectName = location.objectName;
    const configXmlPath = path.join(location.configRoot, 'Configuration.xml');
    const configXml = fs.readFileSync(configXmlPath, 'utf-8');

    const oldDirPath = path.join(location.configRoot, location.folderName, oldObjectName);
    const newDirPath = path.join(location.configRoot, location.folderName, newObjectName);
    const oldFilePath = path.join(location.configRoot, location.folderName, `${oldObjectName}.xml`);
    const newFilePath = path.join(location.configRoot, location.folderName, `${newObjectName}.xml`);
    const oldDeepXmlPath = path.join(oldDirPath, `${oldObjectName}.xml`);
    const newDeepXmlPath = path.join(newDirPath, `${newObjectName}.xml`);
    const isDeep = fs.existsSync(oldDirPath);

    if ((isDeep && fs.existsSync(newDirPath)) || (!isDeep && fs.existsSync(newFilePath))) {
      return this.fail(`Объект с именем "${newObjectName}" уже существует.`);
    }
    if (!fs.existsSync(oldFilePath) && !isDeep) {
      return this.fail(`Не найден файл объекта: ${oldFilePath}`);
    }

    const objectXml = fs.readFileSync(currentXmlPath, 'utf-8');
    const objectXmlUpdated = this.replaceSimpleTagValue(objectXml, 'Name', newObjectName);
    if (!objectXmlUpdated) {
      return this.fail('Не удалось обновить тег <Name> в XML объекта.');
    }

    const configUpdated = this.replaceChildObjectName(configXml, childObjectTag, oldObjectName, newObjectName);
    if (!configUpdated) {
      return this.fail(`Не удалось обновить ${childObjectTag} в Configuration.xml.`);
    }

    const changedFiles: string[] = [configXmlPath];
    let resultXmlPath = currentXmlPath;
    if (isDeep) {
      fs.renameSync(oldDirPath, newDirPath);
      const oldNameXmlInNewDir = path.join(newDirPath, `${oldObjectName}.xml`);
      if (fs.existsSync(oldNameXmlInNewDir)) {
        fs.renameSync(oldNameXmlInNewDir, newDeepXmlPath);
      }
      if (this.isSamePath(currentXmlPath, oldDeepXmlPath)) {
        resultXmlPath = newDeepXmlPath;
      }
      changedFiles.push(newDirPath);
    }

    if (fs.existsSync(oldFilePath)) {
      fs.renameSync(oldFilePath, newFilePath);
    }
    if (!isDeep || !fs.existsSync(newDeepXmlPath)) {
      fs.writeFileSync(newFilePath, objectXmlUpdated, 'utf-8');
      resultXmlPath = newFilePath;
      changedFiles.push(newFilePath);
    } else {
      fs.writeFileSync(newDeepXmlPath, objectXmlUpdated, 'utf-8');
      if (this.isSamePath(currentXmlPath, oldDeepXmlPath)) {
        resultXmlPath = newDeepXmlPath;
      }
      changedFiles.push(newDeepXmlPath);
    }

    this.rewriteMetadataReferences(location.configRoot, childObjectTag, oldObjectName, newObjectName);
    fs.writeFileSync(configXmlPath, configUpdated, 'utf-8');
    return {
      success: true,
      changed: true,
      changedFiles,
      warnings: [],
      errors: [],
    };
  }

  private updateDefaultRoles(
    configXmlPath: string,
    mutator: (items: string[]) => { items: string[]; changed: boolean; warning?: string }
  ): EditResult {
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const props = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1];
    if (props === undefined) {
      return this.fail('В Configuration.xml отсутствует блок <Properties>.');
    }
    const rolesBlockRe = /<DefaultRoles>([\s\S]*?)<\/DefaultRoles>/;
    const rolesInner = rolesBlockRe.exec(props)?.[1];
    if (rolesInner === undefined) {
      return this.fail('В Configuration.xml отсутствует блок <DefaultRoles>.');
    }
    const current = Array.from(rolesInner.matchAll(/<xr:Item\s+xsi:type="xr:MDObjectRef">([^<]+)<\/xr:Item>/g)).map((m) => m[1].trim());
    const { items, changed, warning } = mutator(current);
    if (!changed) {
      return warning ? this.warn(warning) : this.warn('Изменения отсутствуют.');
    }

    const indent = this.detectIndent(rolesInner, '\t\t\t\t');
    const nextInner = items.length === 0
      ? ''
      : `\n${items.map((item) => `${indent}<xr:Item xsi:type="xr:MDObjectRef">${escapeXmlText(item)}</xr:Item>`).join('\n')}\n${indent.slice(0, -1)}`;
    const nextProps = props.replace(rolesBlockRe, `<DefaultRoles>${nextInner}</DefaultRoles>`);
    const updatedXml = xml.replace(props, nextProps);
    fs.writeFileSync(configXmlPath, updatedXml, 'utf-8');
    return this.ok([configXmlPath]);
  }

  private buildRootPropertyBlock(propertyName: string, value: string, kind: RootPropertyKind): string {
    if (kind === 'localized') {
      if (!value) {
        return `<${propertyName}></${propertyName}>`;
      }
      return [
        `<${propertyName}>`,
        '\t\t\t\t<v8:item>',
        '\t\t\t\t\t<v8:lang>ru</v8:lang>',
        `\t\t\t\t\t<v8:content>${escapeXmlText(value)}</v8:content>`,
        '\t\t\t\t</v8:item>',
        `</${propertyName}>`,
      ].join('\n');
    }
    const normalized = kind === 'reference' && value && !value.includes('.') ? `Language.${value}` : value;
    return `<${propertyName}>${escapeXmlText(normalized)}</${propertyName}>`;
  }

  private parseTypeAndName(value: string): [string, string] | null {
    const dotIndex = value.indexOf('.');
    if (dotIndex < 1 || dotIndex >= value.length - 1) {
      return null;
    }
    return [value.slice(0, dotIndex).trim(), value.slice(dotIndex + 1).trim()];
  }

  private readChildEntries(block: string): Array<{ type: string; name: string }> {
    return Array.from(block.matchAll(/<([A-Za-z][A-Za-z0-9]*)>([^<]+)<\/\1>/g)).map((m) => ({
      type: m[1],
      name: m[2].trim(),
    }));
  }

  private buildChildObjectsBlock(items: Array<{ type: string; name: string }>, indent: string): string {
    return items.length === 0
      ? ''
      : `\n${items.map((item) => `${indent}<${item.type}>${escapeXmlText(item.name)}</${item.type}>`).join('\n')}\n${indent.slice(0, -1)}`;
  }

  private sortChildObjects(a: { type: string; name: string }, b: { type: string; name: string }): number {
    const order = [
      'Language', 'Subsystem', 'StyleItem', 'Style', 'CommonPicture', 'SessionParameter', 'Role', 'CommonTemplate',
      'FilterCriterion', 'CommonModule', 'CommonAttribute', 'ExchangePlan', 'XDTOPackage', 'WebService', 'HTTPService',
      'WSReference', 'EventSubscription', 'ScheduledJob', 'SettingsStorage', 'FunctionalOption', 'FunctionalOptionsParameter',
      'DefinedType', 'CommonCommand', 'CommandGroup', 'Constant', 'CommonForm', 'Catalog', 'Document', 'DocumentNumerator',
      'Sequence', 'DocumentJournal', 'Enum', 'Report', 'DataProcessor', 'InformationRegister', 'AccumulationRegister',
      'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'AccountingRegister', 'ChartOfCalculationTypes', 'CalculationRegister',
      'BusinessProcess', 'Task', 'IntegrationService',
    ];
    const ai = order.indexOf(a.type);
    const bi = order.indexOf(b.type);
    if (ai !== bi) {
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    }
    return a.name.localeCompare(b.name, 'ru');
  }

  private normalizeRoleRef(roleName: string): string {
    return roleName.startsWith('Role.') ? roleName : `Role.${roleName}`;
  }

  private detectIndent(text: string, fallback: string): string {
    const m = /\n([ \t]+)</.exec(text);
    return m?.[1] ?? fallback;
  }

  private replaceSimpleTagValue(xml: string, tagName: string, nextValue: string): string | null {
    const re = new RegExp(`(<${tagName}>)([\\s\\S]*?)(<\\/${tagName}>)`);
    if (!re.test(xml)) {
      return null;
    }
    return xml.replace(re, `$1${escapeXmlText(nextValue)}$3`);
  }

  private replaceChildObjectName(configXml: string, childTag: string, oldName: string, newName: string): string | null {
    const block = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(configXml)?.[1];
    if (block === undefined) {
      return null;
    }
    let replaced = false;
    const next = block.replace(new RegExp(`(<${childTag}>)([\\s\\S]*?)(<\\/${childTag}>)`, 'g'), (full, open, value, close) => {
      if (replaced || String(value).trim() !== oldName) {
        return full;
      }
      replaced = true;
      return `${open}${escapeXmlText(newName)}${close}`;
    });
    return replaced ? configXml.replace(block, next) : null;
  }

  private isObjectNameOccupiedInType(configXml: string, childTag: string, oldName: string, newName: string): boolean {
    if (oldName === newName) {
      return false;
    }
    const block = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(configXml)?.[1];
    if (block === undefined) {
      return false;
    }
    const re = new RegExp(`<${childTag}>([\\s\\S]*?)<\\/${childTag}>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      if (m[1].trim() === newName) {
        return true;
      }
    }
    return false;
  }

  private rewriteMetadataReferences(configRoot: string, objectType: string, oldName: string, newName: string): void {
    const escapedType = escapeRegExp(objectType);
    const escapedOldName = escapeRegExp(oldName);
    const referenceRe = new RegExp(`\\b${escapedType}\\.${escapedOldName}(?=[^\\p{L}\\p{Nd}_]|$)`, 'gu');
    for (const filePath of this.walkFiles(configRoot)) {
      if (!/\.(xml|bsl)$/i.test(filePath)) {
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const next = content.replace(referenceRe, `${objectType}.${newName}`);
      if (next !== content) {
        fs.writeFileSync(filePath, next, 'utf-8');
      }
    }
  }

  private walkFiles(rootDir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(rootDir)) {
      return out;
    }
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        out.push(...this.walkFiles(fullPath));
        continue;
      }
      out.push(fullPath);
    }
    return out;
  }

  private isSamePath(a: string, b: string): boolean {
    return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
  }

  private ok(changedFiles: string[]): EditResult {
    return { success: true, changed: true, changedFiles, warnings: [], errors: [] };
  }

  private warn(message: string): EditResult {
    return { success: true, changed: false, changedFiles: [], warnings: [message], errors: [] };
  }

  private fail(message: string): EditResult {
    return { success: false, changed: false, changedFiles: [], warnings: [], errors: [message] };
  }
}

function isValidMetadataName(value: string): boolean {
  return /^[\p{L}][\p{L}\p{Nd}_]*$/u.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
