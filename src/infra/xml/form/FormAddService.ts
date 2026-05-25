import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { findNestingAwareElementRange, writeTextFilePreservingBomAndEol } from '../XmlUtils';
import { buildFormXmlFromDefinition } from './FormBuilders';
import { generateFormDefinitionForObject } from './FormObjectGenerator';
import {
  buildLocalizedTag,
  detectFormatVersion,
  escapeRegExp,
  escapeXml,
  extractTag,
  isEmptyTagValue,
  isExternalKind,
  isProcessorLike,
  MD_XMLNS,
  normalizePurpose,
  resolveObjectLocation,
  setTagValue,
  validateName,
  validatePurpose,
  writeNewTextFile,
} from './FormShared';
import type {
  AddFormOptions,
  FormAttributeDefinition,
  FormMutationResult,
  FormPurpose,
  RemoveFormOptions,
} from './types';

export class FormAddService {
  addForm(options: AddFormOptions): FormMutationResult {
    validateName(options.formName, 'Имя формы');
    const loc = resolveObjectLocation(options.objectPath);
    const purpose = normalizePurpose(options.purpose ?? 'Object');
    validatePurpose(loc.kind, purpose);
    const synonym = options.synonym ?? options.formName;
    const formatVersion = detectFormatVersion(loc.xmlPath);
    const formsDir = path.join(loc.objectDir, 'Forms');
    const formMetaPath = path.join(formsDir, `${options.formName}.xml`);
    const formXmlPath = path.join(formsDir, options.formName, 'Ext', 'Form.xml');
    const modulePath = path.join(formsDir, options.formName, 'Ext', 'Form', 'Module.bsl');
    if (fs.existsSync(formMetaPath)) {
      throw new Error(`Форма уже существует: ${formMetaPath}`);
    }

    writeNewTextFile(formMetaPath, buildFormDescriptorXml(options.formName, synonym, formatVersion, isProcessorLike(loc.kind)));
    const autoFill = options.autoFill !== false; // по умолчанию true
    let formXmlContent: string | null = null;
    if (autoFill) {
      const definition = generateFormDefinitionForObject(loc.xmlPath, purpose, { title: synonym });
      if (definition) {
        formXmlContent = buildFormXmlFromDefinition(definition, formatVersion);
      }
    }
    formXmlContent ??= buildInitialFormXml({
      objectKind: loc.kind,
      objectName: loc.name,
      purpose,
      formatVersion,
    });
    writeNewTextFile(formXmlPath, formXmlContent);
    writeNewTextFile(modulePath, buildFormModule(purpose !== 'Object' || !isExternalKind(loc.kind)));

    const original = fs.readFileSync(loc.xmlPath, 'utf-8');
    const defaultProp = defaultFormProperty(loc.kind, purpose);
    const formRef = `${loc.kind}.${loc.name}.Form.${options.formName}`;
    const registered = registerFormInObjectXml(original, options.formName);
    const shouldSetDefault = options.setDefault === true || isEmptyTagValue(registered, defaultProp);
    const next = shouldSetDefault ? setTagValue(registered, defaultProp, formRef, true) : registered;
    writeTextFilePreservingBomAndEol(loc.xmlPath, original, next);

    return { changedFiles: [formMetaPath, formXmlPath, modulePath, loc.xmlPath], warnings: [] };
  }

  removeForm(options: RemoveFormOptions): FormMutationResult {
    validateName(options.formName, 'Имя формы');
    const loc = resolveObjectLocation(options.objectPath);
    const formsDir = path.join(loc.objectDir, 'Forms');
    const formMetaPath = path.join(formsDir, `${options.formName}.xml`);
    const formDir = path.join(formsDir, options.formName);
    if (!fs.existsSync(formMetaPath)) {
      throw new Error(`Метаданные формы не найдены: ${formMetaPath}`);
    }
    const changedFiles = [formMetaPath, loc.xmlPath];
    if (fs.existsSync(formDir)) {
      fs.rmSync(formDir, { recursive: true, force: true });
      changedFiles.push(formDir);
    }
    fs.rmSync(formMetaPath, { force: true });

    const original = fs.readFileSync(loc.xmlPath, 'utf-8');
    let next = removeFormFromObjectXml(original, options.formName);
    for (const prop of ['DefaultForm', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'DefaultRecordForm']) {
      const value = extractTag(next, prop) ?? '';
      if (new RegExp(`\\.Form\\.${escapeRegExp(options.formName)}$`).test(value)) {
        next = setTagValue(next, prop, '');
      }
    }
    writeTextFilePreservingBomAndEol(loc.xmlPath, original, next);
    return { changedFiles, warnings: [] };
  }
}

function buildInitialFormXml(options: {
  readonly objectKind: string;
  readonly objectName: string;
  readonly purpose: FormPurpose;
  readonly formatVersion: string;
}): string {
  const attr = mainAttributeForPurpose(options.objectKind, options.objectName, options.purpose);
  return buildFormXmlFromDefinition({
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    attributes: [attr],
  }, options.formatVersion);
}

export function mainAttributeForPurpose(kind: string, name: string, purpose: FormPurpose): FormAttributeDefinition {
  if (purpose === 'List' || purpose === 'Choice') {
    return { name: 'Список', type: 'DynamicList', main: true, settings: { mainTable: `${kind}.${name}` } };
  }
  if (purpose === 'Record') {
    return { name: 'Запись', type: `InformationRegisterRecordManager.${name}`, main: true, savedData: true };
  }
  const prefix: Record<string, string> = {
    Document: 'DocumentObject',
    Catalog: 'CatalogObject',
    DataProcessor: 'DataProcessorObject',
    Report: 'ReportObject',
    ExternalDataProcessor: 'ExternalDataProcessorObject',
    ExternalReport: 'ExternalReportObject',
    ChartOfAccounts: 'ChartOfAccountsObject',
    ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypesObject',
    ChartOfCalculationTypes: 'ChartOfCalculationTypesObject',
    ExchangePlan: 'ExchangePlanObject',
    BusinessProcess: 'BusinessProcessObject',
    Task: 'TaskObject',
    InformationRegister: 'InformationRegisterRecordManager',
    AccumulationRegister: 'AccumulationRegisterRecordSet',
  };
  return { name: 'Объект', type: `${prefix[kind] ?? `${kind}Object`}.${name}`, main: true, savedData: !isExternalKind(kind) };
}

export function defaultFormProperty(kind: string, purpose: FormPurpose): string {
  if (purpose === 'Object') {
    return isProcessorLike(kind) ? 'DefaultForm' : 'DefaultObjectForm';
  }
  if (purpose === 'List') {
    return 'DefaultListForm';
  }
  if (purpose === 'Choice') {
    return 'DefaultChoiceForm';
  }
  return 'DefaultRecordForm';
}

export function buildFormDescriptorXml(name: string, synonym: string, formatVersion: string, extendedPresentation: boolean): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${MD_XMLNS} version="${formatVersion}">`,
    `\t<Form uuid="${crypto.randomUUID()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', synonym),
    '\t\t\t<Comment/>',
    '\t\t\t<FormType>Managed</FormType>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<UsePurposes>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">MobilePlatformApplication</v8:Value>',
    '\t\t\t</UsePurposes>',
    ...(extendedPresentation ? ['\t\t\t<ExtendedPresentation/>'] : []),
    '\t\t</Properties>',
    '\t</Form>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

export function buildFormModule(withCreateAtServer: boolean): string {
  const createHandler = withCreateAtServer
    ? ['&НаСервере', 'Процедура ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)', '', 'КонецПроцедуры', '']
    : [];
  return [
    '#Область ОбработчикиСобытийФормы',
    '',
    ...createHandler,
    '#КонецОбласти',
    '',
    '#Область ОбработчикиСобытийЭлементовФормы',
    '',
    '#КонецОбласти',
    '',
    '#Область ОбработчикиКомандФормы',
    '',
    '#КонецОбласти',
    '',
    '#Область ОбработчикиОповещений',
    '',
    '#КонецОбласти',
    '',
    '#Область СлужебныеПроцедурыИФункции',
    '',
    '#КонецОбласти',
    '',
  ].join('\n');
}

export function registerFormInObjectXml(xml: string, formName: string): string {
  if (new RegExp(`<Form>\\s*${escapeRegExp(formName)}\\s*<\\/Form>`).test(xml)) {
    return xml;
  }
  const formLine = `\t\t\t<Form>${escapeXml(formName)}</Form>`;
  const childObjects = findNestingAwareElementRange(xml, 'ChildObjects');
  if (!childObjects) {
    throw new Error('Не найден ChildObjects в XML объекта.');
  }
  const openTag = xml.slice(childObjects.start, childObjects.openEnd);
  if (/\/>\s*$/.test(openTag)) {
    return `${xml.slice(0, childObjects.start)}<ChildObjects>\n${formLine}\n\t\t</ChildObjects>${xml.slice(childObjects.end)}`;
  }
  const inner = xml.slice(childObjects.openEnd, childObjects.closeStart);
  const insertBefore = /(\n\s*<(?:Template|TabularSection)>)/.exec(inner);
  const nextInner = insertBefore
    ? `${inner.slice(0, insertBefore.index)}\n${formLine}${inner.slice(insertBefore.index)}`
    : `${inner.trimEnd()}\n${formLine}\n\t\t`;
  return `${xml.slice(0, childObjects.openEnd)}${nextInner}${xml.slice(childObjects.closeStart)}`;
}

export function removeFormFromObjectXml(xml: string, formName: string): string {
  return xml.replace(new RegExp(`\\n?\\s*<Form>\\s*${escapeRegExp(formName)}\\s*<\\/Form>`, 'g'), '');
}
