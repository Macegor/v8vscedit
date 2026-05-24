import * as fs from 'fs';
import * as path from 'path';
import { writeTextFilePreservingBomAndEol } from '../XmlUtils';
import {
  buildFormDescriptorXml,
  defaultFormProperty,
  buildFormModule,
  mainAttributeForPurpose,
  registerFormInObjectXml,
} from './FormAddService';
import { buildFormXmlFromDefinition } from './FormBuilders';
import {
  detectFormatVersion,
  resolveFormXmlPathForWrite,
  resolveObjectLocation,
  unique,
  writeNewTextFile,
} from './FormShared';
import type { CompileFormOptions, FormDefinition, FormMutationResult } from './types';

export class FormCompileService {
  compile(options: CompileFormOptions): FormMutationResult {
    const formPath = resolveFormXmlPathForWrite(options.outputPath);
    const formatVersion = detectFormatVersion(formPath);
    const definition = options.fromObject === true && !options.definition
      ? inferDefinitionFromOutputPath(formPath)
      : options.definition ?? {};
    const compiled = buildFormXmlFromDefinition(definition, formatVersion);
    const original = fs.existsSync(formPath) ? fs.readFileSync(formPath, 'utf-8') : '';
    fs.mkdirSync(path.dirname(formPath), { recursive: true });
    writeTextFilePreservingBomAndEol(formPath, original, compiled);
    const changedFiles = [formPath];
    changedFiles.push(...ensureDescriptorAndRegistrationForCompiledForm(formPath, definition.title));
    return { changedFiles: unique(changedFiles), warnings: [] };
  }
}

function ensureDescriptorAndRegistrationForCompiledForm(formPath: string, title: string | undefined): string[] {
  const parts = formPath.split(path.sep);
  const formsIndex = parts.lastIndexOf('Forms');
  if (formsIndex < 2) {
    return [];
  }
  const formName = parts[formsIndex + 1];
  const objectDir = parts.slice(0, formsIndex).join(path.sep);
  const objectXml = `${objectDir}.xml`;
  if (!formName || !fs.existsSync(objectXml)) {
    return [];
  }
  const changed: string[] = [];
  const descriptor = path.join(objectDir, 'Forms', `${formName}.xml`);
  if (!fs.existsSync(descriptor)) {
    writeNewTextFile(descriptor, buildFormDescriptorXml(formName, title ?? formName, detectFormatVersion(objectXml), true));
    changed.push(descriptor);
  }
  const original = fs.readFileSync(objectXml, 'utf-8');
  const next = registerFormInObjectXml(original, formName);
  if (next !== original) {
    writeTextFilePreservingBomAndEol(objectXml, original, next);
    changed.push(objectXml);
  }
  const modulePath = path.join(objectDir, 'Forms', formName, 'Ext', 'Form', 'Module.bsl');
  if (!fs.existsSync(modulePath)) {
    writeNewTextFile(modulePath, buildFormModule(false));
    changed.push(modulePath);
  }
  return changed;
}

function inferDefinitionFromOutputPath(formPath: string): FormDefinition {
  const parts = formPath.split(path.sep);
  const formsIndex = parts.lastIndexOf('Forms');
  const formName = formsIndex >= 0 ? parts[formsIndex + 1] : 'Форма';
  const objectDir = formsIndex >= 1 ? parts.slice(0, formsIndex).join(path.sep) : '';
  const objectXml = `${objectDir}.xml`;
  if (!fs.existsSync(objectXml)) {
    return { title: formName };
  }
  const loc = resolveObjectLocation(objectXml);
  return {
    title: formName,
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    attributes: [mainAttributeForPurpose(loc.kind, loc.name, 'Object')],
  };
}

// re-exports for backward compat
export { defaultFormProperty };
