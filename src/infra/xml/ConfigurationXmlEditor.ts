import * as fs from 'fs';
import * as path from 'path';
import { getMetaFolder, type MetaKind } from '../../domain/MetaTypes';
import { getObjectLocationFromXml } from '../fs/ObjectLocation';
import { ObjectXmlReader } from './ObjectXmlReader';
import { escapeRegExp, escapeXmlText, writeTextFilePreservingBomAndEol } from './XmlUtils';

type PropertyValueKind = 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList';
type RootPropertyKind = 'scalar' | 'localized' | 'reference' | 'boolean' | 'multiEnum';

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
      targetKind: 'Self' | 'StandardAttribute' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'Command' | 'EnumValue' | 'URLTemplate' | 'Method';
      targetName: string;
      tabularSectionName?: string;
      urlTemplateName?: string;
      propertyKey: string;
      valueKind: PropertyValueKind;
      value: string | boolean | string[];
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
      targetKind:
        | 'Attribute'
        | 'AddressingAttribute'
        | 'Dimension'
        | 'Resource'
        | 'Column'
        | 'SessionParameter'
        | 'CommonAttribute'
        | 'Constant'
        | 'DefinedType'
        | 'EventSubscription'
        | 'CommonCommand'
        | 'Command';
      targetName: string;
      tabularSectionName?: string;
      propertyName?: 'Type' | 'Source' | 'CommandParameterType';
      typeInnerXml: string;
    }
  ): EditResult {
    const changed = this.objectReader.updateTypeInObject(xmlPath, options);
    return changed ? this.ok([xmlPath]) : this.fail('Не удалось изменить тип выбранного элемента.');
  }

  modifyConfigurationProperty(
    configXmlPath: string,
    propertyName: string,
    value: string | boolean | string[],
    kind: RootPropertyKind
  ): EditResult {
    if (kind === 'multiEnum' && propertyName === 'DefaultRoles') {
      const roles = Array.isArray(value) ? value : [String(value)].filter((item) => item.length > 0);
      return this.setDefaultRoles(configXmlPath, roles);
    }
    if (!fs.existsSync(configXmlPath)) {
      return this.fail(`Не найден файл: ${configXmlPath}`);
    }
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const properties = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1];
    if (!properties) {
      return this.fail('В Configuration.xml отсутствует блок <Properties>.');
    }
    const propRe = new RegExp(`<${propertyName}>[\\s\\S]*?<\\/${propertyName}>|<${propertyName}\\s*\\/>`);
    if (!propRe.test(properties)) {
      return this.fail(`Свойство "${propertyName}" не найдено.`);
    }

    const replacement = this.buildRootPropertyBlock(propertyName, value, kind);
    const updatedProps = properties.replace(propRe, () => replacement);
    if (updatedProps === properties) {
      return this.warn('Значение свойства не изменилось.');
    }
    const updatedXml = xml.replace(properties, () => updatedProps);
    writeTextFilePreservingBomAndEol(configXmlPath, xml, updatedXml);
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
    const childObjectsMatch = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(xml);
    const selfClosingChildObjectsMatch = /<ChildObjects\s*\/>/.exec(xml);
    const childObjects = childObjectsMatch?.[1] ?? (selfClosingChildObjectsMatch ? '' : undefined);
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
    const updatedXml = childObjectsMatch
      ? xml.replace(childObjectsMatch[0], () => `<ChildObjects>${nextInner}</ChildObjects>`)
      : selfClosingChildObjectsMatch
        ? xml.replace(selfClosingChildObjectsMatch[0], () => `<ChildObjects>${nextInner}</ChildObjects>`)
        : xml;
    writeTextFilePreservingBomAndEol(configXmlPath, xml, updatedXml);
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
    const updatedXml = xml.replace(childObjects, () => nextInner);
    writeTextFilePreservingBomAndEol(configXmlPath, xml, updatedXml);
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
    if (isDeep) {
      fs.renameSync(oldDirPath, newDirPath);
      const oldNameXmlInNewDir = path.join(newDirPath, `${oldObjectName}.xml`);
      if (fs.existsSync(oldNameXmlInNewDir)) {
        fs.renameSync(oldNameXmlInNewDir, newDeepXmlPath);
      }
      changedFiles.push(newDirPath);
    }

    if (fs.existsSync(oldFilePath)) {
      fs.renameSync(oldFilePath, newFilePath);
    }
    if (!isDeep || !fs.existsSync(newDeepXmlPath)) {
      writeTextFilePreservingBomAndEol(newFilePath, objectXml, objectXmlUpdated);
      changedFiles.push(newFilePath);
    } else {
      writeTextFilePreservingBomAndEol(newDeepXmlPath, objectXml, objectXmlUpdated);
      changedFiles.push(newDeepXmlPath);
    }

    this.rewriteMetadataReferences(location.configRoot, childObjectTag, oldObjectName, newObjectName);
    writeTextFilePreservingBomAndEol(configXmlPath, configXml, configUpdated);
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
    if (!fs.existsSync(configXmlPath)) {
      return this.fail(`Не найден файл: ${configXmlPath}`);
    }
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const props = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1];
    if (props === undefined) {
      return this.fail('В Configuration.xml отсутствует блок <Properties>.');
    }
    const pairedRe = /<DefaultRoles>([\s\S]*?)<\/DefaultRoles>/;
    const selfClosingRe = /<DefaultRoles\s*\/>/;
    const pairedMatch = pairedRe.exec(props);
    const selfClosingMatch = selfClosingRe.exec(props);
    if (!pairedMatch && !selfClosingMatch) {
      return this.fail('В Configuration.xml отсутствует блок <DefaultRoles>.');
    }
    const rolesInner = pairedMatch?.[1] ?? '';
    const current = Array.from(rolesInner.matchAll(/<xr:Item\s+xsi:type="xr:MDObjectRef">([^<]+)<\/xr:Item>/g)).map((m) => m[1].trim());
    const { items, changed, warning } = mutator(current);
    if (!changed) {
      return warning ? this.warn(warning) : this.warn('Изменения отсутствуют.');
    }

    const replacement = this.buildDefaultRolesBlock(items, this.detectIndent(props, '\t\t\t'));
    const nextProps = pairedMatch
      ? props.replace(pairedRe, () => replacement)
      : props.replace(selfClosingRe, () => replacement);
    const updatedXml = xml.replace(props, () => nextProps);
    writeTextFilePreservingBomAndEol(configXmlPath, xml, updatedXml);
    return this.ok([configXmlPath]);
  }

  private buildDefaultRolesBlock(items: readonly string[], outerIndent: string): string {
    if (items.length === 0) {
      return '<DefaultRoles/>';
    }
    const innerIndent = `${outerIndent}\t`;
    const lines = items.map((item) => `${innerIndent}<xr:Item xsi:type="xr:MDObjectRef">${escapeXmlText(item)}</xr:Item>`);
    return `<DefaultRoles>\n${lines.join('\n')}\n${outerIndent}</DefaultRoles>`;
  }

  private buildRootPropertyBlock(propertyName: string, value: string | boolean | string[], kind: RootPropertyKind): string {
    if (kind === 'boolean') {
      return `<${propertyName}>${value === true ? 'true' : 'false'}</${propertyName}>`;
    }
    if (kind === 'multiEnum' && propertyName === 'UsePurposes') {
      const values = Array.isArray(value) ? value : [String(value)].filter((item) => item.length > 0);
      if (values.length === 0) {
        return '<UsePurposes/>';
      }
      return [
        '<UsePurposes>',
        ...values.map((item) => `\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">${escapeXmlText(item)}</v8:Value>`),
        '</UsePurposes>',
      ].join('\n');
    }
    if (kind === 'localized') {
      const localizedValue = String(value);
      if (!localizedValue) {
        return `<${propertyName}></${propertyName}>`;
      }
      return [
        `<${propertyName}>`,
        '\t\t\t\t<v8:item>',
        '\t\t\t\t\t<v8:lang>ru</v8:lang>',
        `\t\t\t\t\t<v8:content>${escapeXmlText(localizedValue)}</v8:content>`,
        '\t\t\t\t</v8:item>',
        `</${propertyName}>`,
      ].join('\n');
    }
    const stringValue = String(value);
    const normalized = kind === 'reference' && stringValue && !stringValue.includes('.') ? `Language.${stringValue}` : stringValue;
    return `<${propertyName}>${escapeXmlText(normalized)}</${propertyName}>`;
  }

  private parseTypeAndName(value: string): [string, string] | null {
    const dotIndex = value.indexOf('.');
    if (dotIndex < 1 || dotIndex >= value.length - 1) {
      return null;
    }
    return [value.slice(0, dotIndex).trim(), value.slice(dotIndex + 1).trim()];
  }

  private readChildEntries(block: string): { type: string; name: string }[] {
    return Array.from(block.matchAll(/<([A-Za-z][A-Za-z0-9]*)>([^<]+)<\/\1>/g)).map((m) => ({
      type: m[1],
      name: m[2].trim(),
    }));
  }

  private buildChildObjectsBlock(items: { type: string; name: string }[], indent: string): string {
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
    return xml.replace(re, (_m, open: string, _value: string, close: string) => `${open}${escapeXmlText(nextValue)}${close}`);
  }

  private replaceChildObjectName(configXml: string, childTag: string, oldName: string, newName: string): string | null {
    const block = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(configXml)?.[1];
    if (block === undefined) {
      return null;
    }
    let replaced = false;
    const next = block.replace(new RegExp(`(<${childTag}>)([\\s\\S]*?)(<\\/${childTag}>)`, 'g'), (full: string, open: string, value: string, close: string) => {
      if (replaced || value.trim() !== oldName) {
        return full;
      }
      replaced = true;
      return `${open}${escapeXmlText(newName)}${close}`;
    });
    return next !== block ? configXml.replace(block, () => next) : null;
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
        writeTextFilePreservingBomAndEol(filePath, content, next);
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
