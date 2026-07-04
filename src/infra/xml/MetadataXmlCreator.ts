import * as fs from 'fs';
import * as path from 'path';
import { getMetaFolder } from '../../domain/MetaTypes';
import { ConfigurationXmlEditor, type EditResult } from './ConfigurationXmlEditor';
import { resolveFormatRuleset } from './format/formatRegistry';
import { writeTextFilePreservingBomAndEol } from './XmlUtils';
import {
  buildBusinessProcessFlowchartXml,
  buildEmptyRightsXml,
  buildManagedFormXml,
  ensureTemplateContentFiles,
} from './creator/auxiliaryFileBuilders';
import { addChildToObjectXml, ensureAuxiliaryChildFiles } from './creator/childElementBuilders';
import {
  ensureEmptyFile,
  fail,
  getDefaultModulePaths,
  ok,
  resolveConfigFormatVersion,
  resolveObjectFormatVersion,
  resolveTemplateType,
  validateMetadataName,
  type AddChildMetadataOptions,
  type AddRootMetadataOptions,
  type TemplateType,
} from './creator/creatorShared';
import { buildRootObjectXml } from './creator/rootObjectBuilders';

export type { AddChildMetadataOptions, AddRootMetadataOptions, TemplateType };

/**
 * Создаёт минимально полноценные XML-исходники метаданных внутри выгрузки.
 * Нужен runtime-расширению, чтобы не зависеть от локальных `.codex/skills`.
 */
export class MetadataXmlCreator {
  private readonly configEditor = new ConfigurationXmlEditor();

  addRootObject(options: AddRootMetadataOptions): EditResult {
    const validation = validateMetadataName(options.name);
    if (!validation.success) {
      return validation;
    }

    const folder = getMetaFolder(options.kind);
    if (!folder) {
      return fail(`Тип "${options.kind}" не поддерживает создание файлов.`);
    }

    const typeDir = path.join(options.configRoot, folder);
    const xmlPath = path.join(typeDir, `${options.name}.xml`);
    const objectDir = path.join(typeDir, options.name);
    if (fs.existsSync(xmlPath) || fs.existsSync(objectDir)) {
      return fail(`Объект "${options.kind}.${options.name}" уже существует.`);
    }

    fs.mkdirSync(typeDir, { recursive: true });
    const formatVersion = resolveConfigFormatVersion(options.configRoot);
    const ruleset = resolveFormatRuleset(formatVersion);
    const templateType = options.kind === 'CommonTemplate' ? resolveTemplateType(options.templateType) : undefined;
    fs.writeFileSync(xmlPath, buildRootObjectXml(options.kind, options.name, formatVersion, ruleset, templateType), 'utf-8');

    const changedFiles = [xmlPath];
    if (options.kind === 'CommonTemplate') {
      changedFiles.push(...ensureTemplateContentFiles(objectDir, templateType ?? 'SpreadsheetDocument', formatVersion));
    }
    for (const modulePath of getDefaultModulePaths(options.kind, objectDir)) {
      ensureEmptyFile(modulePath);
      changedFiles.push(modulePath);
    }
    if (options.kind === 'CommonForm') {
      const formXmlPath = path.join(objectDir, 'Ext', 'Form.xml');
      fs.mkdirSync(path.dirname(formXmlPath), { recursive: true });
      fs.writeFileSync(formXmlPath, buildManagedFormXml(formatVersion), 'utf-8');
      changedFiles.push(formXmlPath);
    }

    if (options.kind === 'Role') {
      const rightsPath = path.join(objectDir, 'Ext', 'Rights.xml');
      fs.mkdirSync(path.dirname(rightsPath), { recursive: true });
      fs.writeFileSync(rightsPath, buildEmptyRightsXml(formatVersion), 'utf-8');
      changedFiles.push(rightsPath);
    }

    if (options.kind === 'BusinessProcess') {
      const flowchartPath = path.join(objectDir, 'Ext', 'Flowchart.xml');
      fs.mkdirSync(path.dirname(flowchartPath), { recursive: true });
      fs.writeFileSync(flowchartPath, buildBusinessProcessFlowchartXml(formatVersion), 'utf-8');
      changedFiles.push(flowchartPath);
    }

    const configXmlPath = path.join(options.configRoot, 'Configuration.xml');
    const register = this.configEditor.addChildObject(configXmlPath, `${options.kind}.${options.name}`);
    if (!register.success) {
      return register;
    }

    return ok([...changedFiles, ...register.changedFiles]);
  }

  addChildElement(options: AddChildMetadataOptions): EditResult {
    const validation = validateMetadataName(options.name);
    if (!validation.success) {
      return validation;
    }
    if (!fs.existsSync(options.ownerObjectXmlPath)) {
      return fail(`Не найден XML владельца: ${options.ownerObjectXmlPath}`);
    }

    const formatVersion = resolveObjectFormatVersion(options.ownerObjectXmlPath);
    const ruleset = resolveFormatRuleset(formatVersion);
    const xml = fs.readFileSync(options.ownerObjectXmlPath, 'utf-8');
    const nextXml = addChildToObjectXml(xml, options, ruleset);
    if (!nextXml.changed) {
      return fail(nextXml.error);
    }

    writeTextFilePreservingBomAndEol(options.ownerObjectXmlPath, xml, nextXml.xml);
    const changedFiles = [options.ownerObjectXmlPath];
    changedFiles.push(...ensureAuxiliaryChildFiles(options, formatVersion, ruleset));
    return ok(changedFiles);
  }
}
