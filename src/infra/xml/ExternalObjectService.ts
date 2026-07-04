import * as fs from 'fs';
import * as path from 'path';
import { writeTextFilePreservingBomAndEol } from './XmlUtils';
import {
  buildExternalObjectXml,
  buildHelpDescriptorXml,
  buildHelpHtml,
} from './external/externalObjectXml';
import {
  ensureNewExternalObject,
  findFormDescriptorFiles,
  insertIncludeHelpInContents,
  resolveObjectModulePath,
  writeExternalObjectFiles,
  writeMainSkdTemplate,
} from './external/externalObjectFiles';
import {
  buildBspCommandBlock,
  buildBspRegistrationFunction,
  defaultCommandType,
  detectBspKind,
  ensureClientCommandHandler,
  ensurePrintHandler,
  ensureServerCommandHandler,
  findFirstFormModule,
  insertBspCommandBlock,
  insertIntoPublicRegion,
  isTargetedKind,
  normalizeBspCommandType,
  normalizeBspKind,
  requiresTargets,
} from './external/bspRegistration';
import { runValidation } from './external/externalObjectValidation';
import {
  detectFormatVersion,
  resolveExternalObjectLocation,
  validateBspIdentifier,
  validateLang,
  validateName,
  writeNewTextFile,
} from './external/externalObjectShared';

export type { BspProcessingKind, BspCommandType } from './external/bspRegistration';
export type {
  ExternalObjectValidationOptions,
  ExternalObjectValidationResult,
} from './external/externalObjectValidation';

import type { BspCommandType, BspProcessingKind } from './external/bspRegistration';
import type {
  ExternalObjectValidationOptions,
  ExternalObjectValidationResult,
} from './external/externalObjectValidation';

export interface AddHelpOptions {
  readonly objectPath: string;
  readonly lang?: string;
  readonly title?: string;
}

export interface CreateExternalObjectOptions {
  readonly name: string;
  readonly synonym?: string;
  readonly outputDir: string;
}

export interface CreateExternalReportOptions extends CreateExternalObjectOptions {
  readonly withSkd?: boolean;
}

export interface ExternalObjectMutationResult {
  readonly rootPath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

export interface BspRegistrationOptions {
  readonly objectPath: string;
  // Принимаем как известные значения BspProcessingKind, так и произвольную строку.
  readonly kind: BspProcessingKind | (string & {});
  readonly targets?: readonly string[];
}

export interface AddBspCommandOptions {
  readonly objectPath: string;
  readonly identifier: string;
  readonly commandType?: BspCommandType | (string & {});
  readonly presentation?: string;
  readonly formModulePath?: string;
}

export class ExternalObjectService {
  addHelp(options: AddHelpOptions): ExternalObjectMutationResult {
    const lang = (options.lang ?? 'ru').trim() || 'ru';
    validateLang(lang);
    const location = resolveExternalObjectLocation(options.objectPath);
    const extDir = path.join(location.objectDir, 'Ext');
    if (!fs.existsSync(extDir)) {
      throw new Error(`Каталог Ext не найден: ${extDir}`);
    }

    const helpXmlPath = path.join(extDir, 'Help.xml');
    if (fs.existsSync(helpXmlPath)) {
      throw new Error(`Справка уже существует: ${helpXmlPath}`);
    }

    const formatVersion = detectFormatVersion(location.xmlPath ?? location.objectDir);
    const helpDir = path.join(extDir, 'Help');
    const htmlPath = path.join(helpDir, `${lang}.html`);
    fs.mkdirSync(helpDir, { recursive: true });
    writeNewTextFile(helpXmlPath, buildHelpDescriptorXml(formatVersion, lang));
    writeNewTextFile(htmlPath, buildHelpHtml(options.title ?? location.name));

    const changedFiles = [helpXmlPath, htmlPath];
    for (const formXmlPath of findFormDescriptorFiles(location.objectDir)) {
      const original = fs.readFileSync(formXmlPath, 'utf-8');
      if (/<IncludeHelpInContents\b/.test(original)) {
        continue;
      }
      const next = insertIncludeHelpInContents(original);
      if (next === original) {
        continue;
      }
      writeTextFilePreservingBomAndEol(formXmlPath, original, next);
      changedFiles.push(formXmlPath);
    }

    return { rootPath: location.objectDir, changedFiles, warnings: [] };
  }

  createExternalDataProcessor(options: CreateExternalObjectOptions): ExternalObjectMutationResult {
    validateName(options.name);
    const outputDir = path.resolve(options.outputDir);
    const rootFile = path.join(outputDir, `${options.name}.xml`);
    const objectDir = path.join(outputDir, options.name);
    ensureNewExternalObject(rootFile, objectDir);

    const changedFiles = writeExternalObjectFiles({
      rootFile,
      objectDir,
      xml: buildExternalObjectXml({
        type: 'ExternalDataProcessor',
        name: options.name,
        synonym: options.synonym ?? options.name,
      }),
    });
    return { rootPath: rootFile, changedFiles, warnings: [] };
  }

  createExternalReport(options: CreateExternalReportOptions): ExternalObjectMutationResult {
    validateName(options.name);
    const outputDir = path.resolve(options.outputDir);
    const rootFile = path.join(outputDir, `${options.name}.xml`);
    const objectDir = path.join(outputDir, options.name);
    ensureNewExternalObject(rootFile, objectDir);

    const changedFiles = writeExternalObjectFiles({
      rootFile,
      objectDir,
      xml: buildExternalObjectXml({
        type: 'ExternalReport',
        name: options.name,
        synonym: options.synonym ?? options.name,
        withSkd: options.withSkd === true,
      }),
    });

    if (options.withSkd === true) {
      changedFiles.push(...writeMainSkdTemplate(objectDir));
    }

    return { rootPath: rootFile, changedFiles, warnings: [] };
  }

  initBspRegistration(options: BspRegistrationOptions): ExternalObjectMutationResult {
    const objectModulePath = resolveObjectModulePath(options.objectPath);
    if (!fs.existsSync(objectModulePath)) {
      throw new Error(`Модуль объекта не найден: ${objectModulePath}`);
    }
    const kind = normalizeBspKind(options.kind);
    const targets = options.targets ?? [];
    if (requiresTargets(kind) && targets.length === 0) {
      throw new Error(`Для вида "${kind}" нужно указать назначение.`);
    }
    const original = fs.readFileSync(objectModulePath, 'utf-8');
    if (/Функция\s+СведенияОВнешнейОбработке\s*\(/i.test(original)) {
      throw new Error('Функция СведенияОВнешнейОбработке уже существует.');
    }

    const snippet = buildBspRegistrationFunction(kind, targets);
    const next = insertIntoPublicRegion(original, snippet);
    writeTextFilePreservingBomAndEol(objectModulePath, original, next);
    return { rootPath: objectModulePath, changedFiles: [objectModulePath], warnings: [] };
  }

  addBspCommand(options: AddBspCommandOptions): ExternalObjectMutationResult {
    validateBspIdentifier(options.identifier);
    const objectModulePath = resolveObjectModulePath(options.objectPath);
    if (!fs.existsSync(objectModulePath)) {
      throw new Error(`Модуль объекта не найден: ${objectModulePath}`);
    }

    const original = fs.readFileSync(objectModulePath, 'utf-8');
    if (!/Функция\s+СведенияОВнешнейОбработке\s*\(/i.test(original)) {
      throw new Error('Сначала добавьте СведенияОВнешнейОбработке.');
    }
    if (original.includes(`"${options.identifier}"`) || original.includes(`Идентификатор        = ${options.identifier}`)) {
      throw new Error(`Команда "${options.identifier}" уже есть в модуле.`);
    }

    const kind = detectBspKind(original);
    const commandType = normalizeBspCommandType(options.commandType ?? defaultCommandType(kind));
    const presentation = options.presentation ?? options.identifier;
    let nextObjectModule = insertBspCommandBlock(original, buildBspCommandBlock({
      identifier: options.identifier,
      presentation,
      commandType,
      printKind: kind === 'ПечатнаяФорма',
    }));
    const changedFiles = new Set<string>([objectModulePath]);

    if (kind === 'ПечатнаяФорма') {
      nextObjectModule = ensurePrintHandler(nextObjectModule, options.identifier, presentation);
    } else if (commandType === 'ВызовСерверногоМетода') {
      nextObjectModule = ensureServerCommandHandler(nextObjectModule, options.identifier, isTargetedKind(kind));
    } else if (commandType === 'ВызовКлиентскогоМетода') {
      const formModulePath = options.formModulePath ?? findFirstFormModule(resolveExternalObjectLocation(options.objectPath).objectDir);
      if (!formModulePath) {
        throw new Error('Для клиентского обработчика нужен модуль формы. Передайте formModulePath или добавьте форму.');
      }
      const formOriginal = fs.existsSync(formModulePath) ? fs.readFileSync(formModulePath, 'utf-8') : '';
      const formNext = ensureClientCommandHandler(formOriginal, options.identifier, isTargetedKind(kind));
      writeTextFilePreservingBomAndEol(formModulePath, formOriginal, formNext);
      changedFiles.add(formModulePath);
    }

    writeTextFilePreservingBomAndEol(objectModulePath, original, nextObjectModule);
    return { rootPath: objectModulePath, changedFiles: [...changedFiles], warnings: [] };
  }

  validate(options: ExternalObjectValidationOptions): ExternalObjectValidationResult {
    return runValidation(options);
  }
}
