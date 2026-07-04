import * as fs from 'fs';
import * as path from 'path';
import {
  buildEmptyObjectModule,
  buildEmptySkdXml,
  buildTemplateDescriptorXml,
} from './externalObjectXml';
import { resolveExternalObjectLocation, writeNewTextFile } from './externalObjectShared';

export function writeExternalObjectFiles(options: { rootFile: string; objectDir: string; xml: string }): string[] {
  fs.mkdirSync(path.join(options.objectDir, 'Ext'), { recursive: true });
  writeNewTextFile(options.rootFile, options.xml);
  const modulePath = path.join(options.objectDir, 'Ext', 'ObjectModule.bsl');
  writeNewTextFile(modulePath, buildEmptyObjectModule());
  return [options.rootFile, modulePath];
}

export function ensureNewExternalObject(rootFile: string, objectDir: string): void {
  if (fs.existsSync(rootFile)) {
    throw new Error(`Файл уже существует: ${rootFile}`);
  }
  if (fs.existsSync(objectDir)) {
    throw new Error(`Каталог уже существует: ${objectDir}`);
  }
}

export function writeMainSkdTemplate(objectDir: string): string[] {
  const name = 'ОсновнаяСхемаКомпоновкиДанных';
  const templateXmlPath = path.join(objectDir, 'Templates', `${name}.xml`);
  const templateContentPath = path.join(objectDir, 'Templates', name, 'Ext', 'Template.xml');
  fs.mkdirSync(path.dirname(templateContentPath), { recursive: true });
  writeNewTextFile(templateXmlPath, buildTemplateDescriptorXml(name));
  writeNewTextFile(templateContentPath, buildEmptySkdXml());
  return [templateXmlPath, templateContentPath];
}

export function resolveObjectModulePath(objectPath: string): string {
  const location = resolveExternalObjectLocation(objectPath);
  return path.join(location.objectDir, 'Ext', 'ObjectModule.bsl');
}

export function findFormDescriptorFiles(objectDir: string): string[] {
  const formsDir = path.join(objectDir, 'Forms');
  if (!fs.existsSync(formsDir)) {
    return [];
  }
  return fs.readdirSync(formsDir)
    .filter((file) => file.toLowerCase().endsWith('.xml'))
    .map((file) => path.join(formsDir, file))
    .filter((filePath) => fs.statSync(filePath).isFile());
}

export function insertIncludeHelpInContents(xml: string): string {
  return xml.replace(/(<FormType>[\s\S]*?<\/FormType>)(?![\s\S]*?<IncludeHelpInContents\b)/, '$1\n\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>');
}
