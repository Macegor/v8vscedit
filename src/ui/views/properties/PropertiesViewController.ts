import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MetadataNode } from '../../tree/TreeNode';
import type {
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataReferenceListValue,
  MetadataTypeValue,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from '../../tree/nodeBuilders/_types';
import { TypeRegistryService } from './TypeRegistryService';
import {
  buildCommandParameterTypeInnerXml,
  buildMetadataTypeInnerXml,
  ensureDefaultQualifiers,
} from './MetadataTypeService';
import { buildEventSourceInnerXml } from './EventSubscriptionPropertyService';
import { toCanonicalPropertyInput } from './PropertyPresentationRegistry';
import {
  BasedOnXmlService,
  type BasedOnMetaKind,
  ConfigurationXmlEditor,
  extractSimpleTag,
  extractStandardAttributeXml,
  parseConfigXml,
  parseObjectXml,
} from '../../../infra/xml';
import { extractChildMetaElementXml, extractColumnXmlFromTabularSection } from '../../../infra/xml';
import type { RepositoryService } from '../../../infra/repository/RepositoryService';
import { type SupportInfoService, SupportMode } from '../../../infra/support/SupportInfoService';
import { getHandlerForNode } from '../../tree/nodeBuilders/index';
import type {
  PropertyControl,
  PropertySection,
  PropertiesViewState,
} from './_types';
import { getObjectLocationFromXml } from '../../../infra/fs';
import { META_TYPES } from '../../../domain/MetaTypes';
import { getDefaultStandardAttributeIndexing } from '../../../domain/StandardAttribute';
import type {
  SubsystemMembershipSnapshot,
  SubsystemMembershipTreeNode,
  SubsystemXmlService,
} from '../../../infra/xml/SubsystemXmlService';
import type { ExchangePlanContentSnapshot } from '../../../infra/xml/ExchangePlanContentService';
import type { ExchangePlanContentService } from '../../../infra/xml/ExchangePlanContentService';
import type { PropertiesRenderContext } from './rendering/_types';
import {
  arePropertyEditValuesEqual,
  extractFormNameFromReference,
  getEmptyReferencePickerMessage,
  getReferencePickerTitle,
  toMetadataReferenceDisplay,
  toMetadataReferenceListItem,
  toNumberOrUndefined,
} from './PropertiesViewUtils';
import {
  extractUuidFromXml,
  isRootObjectNode,
  isValidMetadataName,
  resolvePropertyTarget,
  resolveTypeRegistryFilter,
  resolveTypeTarget,
} from './PropertiesTargetResolver';

interface PropertiesViewControllerHost {
  refreshActiveView(): void;
  replaceActiveNode(node: MetadataNode): void;
}

/** Управляет чтением и изменением свойств активного объекта. */
export class PropertiesViewController {
  private activeNode: MetadataNode | undefined;
  private activeProperties: ObjectPropertiesCollection = [];
  private propertyUpdateQueue: Promise<void> = Promise.resolve();
  private readonly typeRegistry = new TypeRegistryService();
  private readonly xmlEditor = new ConfigurationXmlEditor();
  private readonly basedOnService = new BasedOnXmlService();

  constructor(
    private readonly subsystemXmlService: SubsystemXmlService,
    private readonly exchangePlanContentService: ExchangePlanContentService,
    private readonly host: PropertiesViewControllerHost,
    private readonly supportService?: SupportInfoService,
    private readonly repositoryService?: RepositoryService,
    private readonly onAfterRename?: (configRoot: string, oldXmlPath: string, newXmlPath: string) => void,
    private readonly onAfterSubsystemMembershipSave?: () => void
  ) {}

  setActiveNode(node: MetadataNode): void {
    this.activeNode = node;
  }

  clearActiveNode(): void {
    this.activeNode = undefined;
    this.activeProperties = [];
  }

  getActiveNode(): MetadataNode | undefined {
    return this.activeNode;
  }

  /** Возвращает сериализуемое состояние для Vue-панели свойств. */
  getViewState(): PropertiesViewState | null {
    const node = this.activeNode;
    if (!node) {
      return null;
    }

    const handler = getHandlerForNode(node);
    const canShow = handler?.canShowProperties?.(node) ?? false;
    if (!handler?.getProperties || !canShow) {
      return null;
    }

    const properties = handler.getProperties(node);
    const context = this.buildRenderContext(node, properties);
    if (context.properties.length === 0) {
      return null;
    }

    const controls = context.properties.map((prop) => this.toControl(prop, context.isEditLocked));
    const sections = this.groupIntoSections(controls, context.properties);

    let readonlyReason: PropertiesViewState['readonlyReason'];
    if (context.isEditLockedBySupport) {
      readonlyReason = 'support';
    } else if (context.isEditLockedByRepository) {
      readonlyReason = 'repository';
    }

    return {
      title: `${node.textLabel} — Свойства`,
      readonly: context.isEditLocked,
      readonlyReason,
      sections,
    };
  }

  /** Обрабатывает изменение простого свойства из Vue-приложения. */
  handlePropertyChange(controlId: string, value: unknown): void {
    void this.handleWebviewMessage({
      type: 'propertyChanged' as const,
      key: controlId,
      value: value as string | boolean | string[] | undefined,
    });
  }

  buildRenderContext(node: MetadataNode, properties: ObjectPropertiesCollection): PropertiesRenderContext {
    const enrichedProperties = this.enrichBasedOnProperties(node, properties);
    this.activeNode = node;
    this.activeProperties = enrichedProperties;
    const subsystemSnapshot = this.resolveSubsystemMembershipSnapshot(node);
    const exchangePlanContentSnapshot = this.resolveExchangePlanContentSnapshot(node);
    const editLockReason = this.resolveEditLockReason(node);
    const isEditLocked = editLockReason !== undefined;
    return {
      node,
      properties: enrichedProperties,
      isEditLocked,
      isEditLockedBySupport: editLockReason === 'support',
      isEditLockedByRepository: editLockReason === 'repository',
      subsystemSnapshot,
      exchangePlanContentSnapshot,
    };
  }

  enrichBasedOnProperties(node: MetadataNode, properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
    const objectKind = this.resolveBasedOnKind(node);
    if (!objectKind || !node.xmlPath) {
      return properties;
    }
    const location = getObjectLocationFromXml(node.xmlPath);
    const snapshot = this.basedOnService.readSnapshot(location.configRoot, objectKind, node.textLabel);
    const basedOn = properties.find((item) => item.key === 'BasedOn');
    const baseSection = basedOn?.section ?? 'Ввод на основании';
    const baseSectionOrder = basedOn?.sectionOrder ?? 120;
    const normalizedBasedOn: ObjectPropertyItem = {
      key: 'BasedOn',
      title: 'Вводится на основании',
      kind: 'metadataReferenceList',
      value: { items: snapshot.basedOn.map(toMetadataReferenceListItem) },
      section: baseSection,
      sectionOrder: baseSectionOrder,
      readonly: basedOn?.readonly === true,
      inherited: basedOn?.inherited,
      source: basedOn?.source,
    };
    const basedFor: ObjectPropertyItem = {
      key: 'BasedFor',
      title: 'Является основанием для',
      kind: 'metadataReferenceList',
      value: { items: snapshot.basedFor.map(toMetadataReferenceListItem) },
      section: baseSection,
      sectionOrder: baseSectionOrder,
    };
    const result = properties.filter((item) => item.key !== 'BasedOn' && item.key !== 'BasedFor');
    const insertAfter = result.findIndex((item) => (item.sectionOrder ?? 0) > baseSectionOrder);
    const basedItems = [normalizedBasedOn, basedFor];
    if (insertAfter < 0) {
      result.push(...basedItems);
    } else {
      result.splice(insertAfter, 0, ...basedItems);
    }
    return result;
  }

  async handleWebviewMessage(message: unknown): Promise<void> {
    const msg = message as {
      type?: string;
      qualifiers?: Record<string, string>;
      presentation?: string;
      key?: string;
      value?: string | boolean | string[];
      kind?: string;
      selectedXmlPaths?: string[];
    };
    if (!this.activeNode) {
      return;
    }
    if (this.isEditLockedByRepository(this.activeNode)) {
      if (
        msg.type === 'openTypePicker' ||
        msg.type === 'openMetadataReferencePicker' ||
        msg.type === 'removeMetadataReference' ||
        msg.type === 'openFormPicker' ||
        msg.type === 'clearFormProperty' ||
        msg.type === 'openSubsystemMembershipPicker' ||
        msg.type === 'removeSubsystemMembership' ||
        msg.type === 'updateTypeQualifiers' ||
        msg.type === 'propertyChanged'
      ) {
        void vscode.window.showWarningMessage('Редактирование свойств запрещено: объект не захвачен в хранилище.');
      }
      return;
    }
    if (this.isEditLockedBySupport(this.activeNode)) {
      if (
        msg.type === 'openTypePicker' ||
        msg.type === 'openMetadataReferencePicker' ||
        msg.type === 'removeMetadataReference' ||
        msg.type === 'openFormPicker' ||
        msg.type === 'clearFormProperty' ||
        msg.type === 'openSubsystemMembershipPicker' ||
        msg.type === 'removeSubsystemMembership' ||
        msg.type === 'updateTypeQualifiers' ||
        msg.type === 'propertyChanged'
      ) {
        void vscode.window.showWarningMessage('Редактирование свойств запрещено поддержкой для этого объекта.');
      }
      return;
    }
    if (msg.type === 'openTypePicker') {
      const key = msg.key ?? 'Type';
      if (this.isCurrentTypeReadonly(key)) {
        this.showReadonlyPropertyWarning(this.activeProperties.find((item) => item.key === key));
        return;
      }
      await this.enqueuePropertyOperation(() => this.handleOpenTypePicker(key));
      return;
    }
    if (msg.type === 'openMetadataReferencePicker') {
      await this.enqueuePropertyOperation(() => this.handleOpenMetadataReferencePicker(msg.key));
      return;
    }
    if (msg.type === 'removeMetadataReference') {
      await this.enqueuePropertyOperation(() => this.removeMetadataReference(msg.key, typeof msg.value === 'string' ? msg.value : undefined));
      return;
    }
    if (msg.type === 'openFormPicker') {
      await this.enqueuePropertyOperation(() => this.handleOpenFormPicker(msg.key));
      return;
    }
    if (msg.type === 'clearFormProperty') {
      await this.enqueuePropertyOperation(() => this.setFormProperty(msg.key, null));
      return;
    }
    if (msg.type === 'openSubsystemMembershipPicker') {
      await this.enqueuePropertyOperation(() => this.handleOpenSubsystemMembershipPicker());
      return;
    }
    if (msg.type === 'removeSubsystemMembership') {
      await this.enqueuePropertyOperation(() => this.removeSubsystemMembership(typeof msg.value === 'string' ? msg.value : undefined));
      return;
    }
    if (msg.type === 'invalidName') {
      void vscode.window.showErrorMessage('Имя должно начинаться с буквы и содержать только буквы, цифры и "_".');
      return;
    }
    if (msg.type === 'updateTypeQualifiers') {
      if (this.isCurrentTypeReadonly('Type')) {
        this.showReadonlyPropertyWarning(this.activeProperties.find((item) => item.key === 'Type'));
        return;
      }
      await this.enqueuePropertyOperation(() => this.applyQualifierChanges(msg.qualifiers ?? {}));
      return;
    }
    if (msg.type === 'propertyChanged') {
      const currentProperty = this.activeProperties.find((item) => item.key === msg.key);
      if (currentProperty?.readonly) {
        this.showReadonlyPropertyWarning(currentProperty);
        return;
      }
      await this.enqueuePropertyOperation(() => this.applyPropertyChange(msg.key, msg.value));
      return;
    }
  }

  /**
   * Выполняет изменения свойств последовательно, чтобы не допускать конкурентной записи XML.
   */
  private async enqueuePropertyOperation(operation: () => void | Promise<void>): Promise<void> {
    const run = this.propertyUpdateQueue.then(async () => {
      await operation();
    });
    this.propertyUpdateQueue = run.catch(() => undefined);
    await run;
  }

  private async handleOpenTypePicker(key: string): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    const current = this.getCurrentTypeValue(key);
    if (!current) {
      return;
    }
    const filter = resolveTypeRegistryFilter(key);
    const groups = this.typeRegistry.getAvailableTypes(this.activeNode.xmlPath, filter);
    const items: (vscode.QuickPickItem & { canonical?: string })[] = [];
    for (const group of groups) {
      items.push({ label: group.title, kind: vscode.QuickPickItemKind.Separator });
      for (const type of group.items) {
        items.push({
          label: type.display,
          description: type.canonical,
          picked: current.items.some((item) => item.canonical === type.canonical),
          canonical: type.canonical,
        });
      }
    }
    const selected = await vscode.window.showQuickPick(items, {
      title: 'Выбор типа',
      canPickMany: true,
      matchOnDescription: true,
    });
    if (!selected || selected.length === 0) {
      return;
    }
    const nextItems = selected
      .filter((item) => item.canonical)
      .map((item) => ({
        canonical: String(item.canonical),
        display: item.label,
        group: String(item.canonical).startsWith('DefinedType.')
          ? 'defined'
          : String(item.canonical).includes('Ref.') || key === 'Source'
          ? 'reference'
          : 'primitive',
      })) as MetadataTypeValue['items'];
    const nextType: MetadataTypeValue = this.normalizeTypeValueForProperty(key, {
      ...current,
      items: nextItems,
      presentation: nextItems.map((item) => item.display).join(', '),
    });
    this.applyTypeValue(key, nextType);
  }

  private async handleOpenMetadataReferencePicker(key?: string): Promise<void> {
    if (!this.activeNode || !key) {
      return;
    }
    const currentProperty = this.activeProperties.find((item) => item.key === key);
    if (currentProperty?.readonly) {
      this.showReadonlyPropertyWarning(currentProperty);
      return;
    }
    if (currentProperty?.kind !== 'metadataReferenceList') {
      void vscode.window.showWarningMessage('Для выбранного свойства список ссылок не поддерживается.');
      return;
    }
    const current = currentProperty.value as MetadataReferenceListValue;
    const selected = new Set(current.items.map((item) => item.canonical));
    const options = this.getMetadataReferenceOptions(key)
      .filter((item) => !selected.has(item.canonical))
      .map((item) => ({
        label: item.display,
        description: item.canonical,
        canonical: item.canonical,
      }));
    if (options.length === 0) {
      void vscode.window.showInformationMessage(getEmptyReferencePickerMessage(key));
      return;
    }
    const picked = await vscode.window.showQuickPick(options, {
      title: getReferencePickerTitle(key),
      matchOnDescription: true,
    });
    if (!picked?.canonical) {
      return;
    }
    this.setMetadataReferenceList(key, [...current.items.map((item) => item.canonical), picked.canonical]);
  }

  private removeMetadataReference(key?: string, value?: string): void {
    if (!key || !value) {
      return;
    }
    const currentProperty = this.activeProperties.find((item) => item.key === key);
    if (currentProperty?.readonly) {
      this.showReadonlyPropertyWarning(currentProperty);
      return;
    }
    if (currentProperty?.kind !== 'metadataReferenceList') {
      return;
    }
    const current = currentProperty.value as MetadataReferenceListValue;
    const next = current.items.map((item) => item.canonical).filter((item) => item !== value);
    if (next.length === current.items.length) {
      return;
    }
    this.setMetadataReferenceList(key, next);
  }

  private async handleOpenFormPicker(key?: string): Promise<void> {
    if (!this.activeNode || !key) {
      return;
    }
    const currentProperty = this.activeProperties.find((item) => item.key === key);
    if (currentProperty?.readonly) {
      this.showReadonlyPropertyWarning(currentProperty);
      return;
    }
    const forms = this.getCurrentObjectForms();
    if (forms.length === 0) {
      void vscode.window.showInformationMessage('У текущего объекта нет форм для выбора.');
      return;
    }
    const currentFormName = typeof currentProperty?.value === 'string'
      ? extractFormNameFromReference(currentProperty.value)
      : '';
    const picked = await vscode.window.showQuickPick(
      forms.map((formName) => ({
        label: formName,
        picked: formName === currentFormName,
      })),
      { title: 'Выбор формы', matchOnDescription: true }
    );
    if (!picked?.label) {
      return;
    }
    this.setFormProperty(key, picked.label);
  }

  private getCurrentObjectForms(): string[] {
    if (!this.activeNode?.xmlPath) {
      return [];
    }
    try {
      const objectInfo = parseObjectXml(this.activeNode.xmlPath);
      return (objectInfo?.children ?? [])
        .filter((child) => child.tag === 'Form')
        .map((child) => child.name)
        .filter((name) => name.length > 0)
        .sort((left, right) => left.localeCompare(right, 'ru'));
    } catch {
      return [];
    }
  }

  private setFormProperty(key: string | undefined, formName: string | null): void {
    if (!this.activeNode || !key) {
      return;
    }
    const currentProperty = this.activeProperties.find((item) => item.key === key);
    if (currentProperty?.readonly) {
      this.showReadonlyPropertyWarning(currentProperty);
      return;
    }
    const propertyTarget = resolvePropertyTarget(this.activeNode);
    if (!propertyTarget || !isRootObjectNode(this.activeNode, propertyTarget)) {
      void vscode.window.showWarningMessage('Выбор формы доступен только для корневого объекта метаданных.');
      return;
    }
    const nextValue = formName ? `${this.activeNode.nodeKind}.${this.activeNode.textLabel}.Form.${formName}` : '';
    const saved = this.xmlEditor.modifyObjectProperty(propertyTarget.xmlPath, {
      targetKind: propertyTarget.targetKind,
      targetName: propertyTarget.targetName,
      tabularSectionName: propertyTarget.tabularSectionName,
      propertyKey: key,
      valueKind: 'string',
      value: nextValue,
    });
    if (!saved.success) {
      void vscode.window.showErrorMessage(saved.errors[0] ?? `Не удалось изменить свойство "${key}".`);
      return;
    }
    if (saved.changed) {
      this.host.refreshActiveView();
    }
  }

  private getMetadataReferenceOptions(key: string): { canonical: string; display: string }[] {
    if (key === 'Owners') {
      return this.getCatalogReferenceOptions();
    }
    if (key === 'InputByString') {
      return this.getInputByStringFieldOptions();
    }
    if (key === 'DataLockFields') {
      return this.getDataLockFieldOptions();
    }
    if (key === 'BasedOn' || key === 'BasedFor') {
      return this.getBasedOnReferenceOptions();
    }
    return [];
  }

  private getCatalogReferenceOptions(): { canonical: string; display: string }[] {
    if (!this.activeNode?.xmlPath) {
      return [];
    }
    try {
      const location = getObjectLocationFromXml(this.activeNode.xmlPath);
      const config = parseConfigXml(path.join(location.configRoot, 'Configuration.xml'));
      return [...(config.childObjects.get('Catalog') ?? [])]
        .sort((left, right) => left.localeCompare(right, 'ru'))
        .map((name) => ({
          canonical: `Catalog.${name}`,
          display: `Справочники.${name}`,
        }));
    } catch {
      return [];
    }
  }

  private getBasedOnReferenceOptions(): { canonical: string; display: string }[] {
    if (!this.activeNode?.xmlPath) {
      return [];
    }
    const objectKind = this.resolveBasedOnKind(this.activeNode);
    if (!objectKind) {
      return [];
    }
    try {
      const location = getObjectLocationFromXml(this.activeNode.xmlPath);
      const currentRef = `${objectKind}.${this.activeNode.textLabel}`;
      return this.basedOnService.readAvailableObjects(location.configRoot)
        .filter((item) => item.ref !== currentRef)
        .map((item) => ({
          canonical: item.ref,
          display: toMetadataReferenceDisplay(item.ref),
        }));
    } catch {
      return [];
    }
  }

  private getInputByStringFieldOptions(): { canonical: string; display: string }[] {
    if (!this.activeNode?.xmlPath) {
      return [];
    }
    try {
      const objectInfo = parseObjectXml(this.activeNode.xmlPath);
      const objectXml = fs.readFileSync(this.activeNode.xmlPath, 'utf-8');
      const objectKind = this.activeNode.nodeKind;
      const objectName = objectInfo?.name ?? this.activeNode.textLabel;
      return (objectInfo?.children ?? [])
        .filter((item) => item.tag === 'StandardAttribute' || item.tag === 'Attribute' || item.tag === 'Dimension' || item.tag === 'Resource')
        .filter((item) => this.isInputByStringFieldIndexed(objectXml, objectKind, item.tag, item.name))
        .map((item) => ({
          canonical: `${objectKind}.${objectName}.${item.tag}.${item.name}`,
          display: item.presentation ?? item.name,
        }));
    } catch {
      return [];
    }
  }

  private getDataLockFieldOptions(): { canonical: string; display: string }[] {
    return this.getCurrentObjectFieldOptions();
  }

  private getCurrentObjectFieldOptions(): { canonical: string; display: string }[] {
    if (!this.activeNode?.xmlPath) {
      return [];
    }
    try {
      const objectInfo = parseObjectXml(this.activeNode.xmlPath);
      const objectKind = this.activeNode.nodeKind;
      const objectName = objectInfo?.name ?? this.activeNode.textLabel;
      return (objectInfo?.children ?? [])
        .filter((item) => item.tag === 'StandardAttribute' || item.tag === 'Attribute' || item.tag === 'Dimension' || item.tag === 'Resource')
        .map((item) => ({
          canonical: `${objectKind}.${objectName}.${item.tag}.${item.name}`,
          display: item.presentation ?? item.name,
        }));
    } catch {
      return [];
    }
  }

  private isInputByStringFieldIndexed(objectXml: string, objectKind: string, tag: string, name: string): boolean {
    const elementXml = tag === 'StandardAttribute'
      ? extractStandardAttributeXml(objectXml, name)
      : extractChildMetaElementXml(objectXml, tag, name);
    const indexing = elementXml ? extractSimpleTag(elementXml, tag === 'StandardAttribute' ? 'xr:Indexing' : 'Indexing') : undefined;
    if (indexing) {
      return indexing !== 'DontIndex';
    }
    if (tag === 'StandardAttribute') {
      const defaultIndexing = getDefaultStandardAttributeIndexing(objectKind, name);
      return defaultIndexing !== undefined && defaultIndexing !== 'DontIndex';
    }
    return false;
  }

  private setMetadataReferenceList(key: string, values: string[]): void {
    if (!this.activeNode) {
      return;
    }
    if (key === 'BasedOn' || key === 'BasedFor') {
      this.setBasedOnReferenceList(key, values);
      return;
    }
    const propertyTarget = resolvePropertyTarget(this.activeNode);
    if (!propertyTarget) {
      void vscode.window.showWarningMessage('Для выбранного узла изменение свойств пока не поддерживается.');
      return;
    }
    const saved = this.xmlEditor.modifyObjectProperty(propertyTarget.xmlPath, {
      targetKind: propertyTarget.targetKind,
      targetName: propertyTarget.targetName,
      tabularSectionName: propertyTarget.tabularSectionName,
      propertyKey: key,
      valueKind: key === 'InputByString' || key === 'DataLockFields' ? 'metadataFieldList' : 'metadataReferenceList',
      value: values,
    });
    if (!saved.success) {
      void vscode.window.showErrorMessage(saved.errors[0] ?? `Не удалось изменить свойство "${key}".`);
      return;
    }
    if (saved.changed) {
      this.host.refreshActiveView();
    }
  }

  private setBasedOnReferenceList(key: 'BasedOn' | 'BasedFor', values: string[]): void {
    if (!this.activeNode?.xmlPath) {
      return;
    }
    const objectKind = this.resolveBasedOnKind(this.activeNode);
    if (!objectKind) {
      void vscode.window.showWarningMessage('Ввод на основании доступен только для справочников и документов.');
      return;
    }
    const location = getObjectLocationFromXml(this.activeNode.xmlPath);
    const result = key === 'BasedOn'
      ? this.basedOnService.setBasedOn(location.configRoot, objectKind, this.activeNode.textLabel, values)
      : this.basedOnService.setBasedFor(location.configRoot, objectKind, this.activeNode.textLabel, values);
    if (result.changed) {
      this.host.refreshActiveView();
    }
  }

  private async handleOpenSubsystemMembershipPicker(): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    const snapshot = this.resolveSubsystemMembershipSnapshot(this.activeNode);
    if (!snapshot) {
      void vscode.window.showWarningMessage('Связь с подсистемами доступна только для корневых объектов метаданных.');
      return;
    }
    const selected = new Set(snapshot.selectedXmlPaths);
    const options = this.flattenSubsystemMembershipTree(snapshot.tree)
      .filter((node) => !selected.has(node.xmlPath))
      .map((node) => ({
        label: node.label,
        description: node.name,
        xmlPath: node.xmlPath,
      }));
    if (options.length === 0) {
      void vscode.window.showInformationMessage('Объект уже включен во все доступные подсистемы.');
      return;
    }
    const picked = await vscode.window.showQuickPick(options, {
      title: 'Добавить подсистему',
      matchOnDescription: true,
    });
    if (!picked?.xmlPath) {
      return;
    }
    this.applySubsystemMembershipChange([...snapshot.selectedXmlPaths, picked.xmlPath]);
  }

  private removeSubsystemMembership(xmlPath: string | undefined): void {
    if (!this.activeNode || !xmlPath) {
      return;
    }
    const snapshot = this.resolveSubsystemMembershipSnapshot(this.activeNode);
    if (!snapshot) {
      return;
    }
    this.applySubsystemMembershipChange(snapshot.selectedXmlPaths.filter((item) => item !== xmlPath));
  }

  private applyQualifierChanges(qualifiers: Record<string, string>): void {
    const current = this.getCurrentTypeValue('Type');
    if (!current) {
      return;
    }
    const next: MetadataTypeValue = ensureDefaultQualifiers({
      ...current,
      stringQualifiers: current.stringQualifiers
        ? {
            length: toNumberOrUndefined(qualifiers.stringLength),
            allowedLength: qualifiers.stringAllowedLength === 'Fixed' ? 'Fixed' : 'Variable',
          }
        : undefined,
      numberQualifiers: current.numberQualifiers
        ? {
            digits: toNumberOrUndefined(qualifiers.numberDigits),
            fractionDigits: toNumberOrUndefined(qualifiers.numberFractionDigits),
            allowedSign: qualifiers.numberAllowedSign === 'Nonnegative' ? 'Nonnegative' : 'Any',
          }
        : undefined,
      dateQualifiers: current.dateQualifiers
        ? {
            dateFractions: qualifiers.dateFractions === 'Date' ? 'Date' : 'DateTime',
          }
        : undefined,
    });
    this.applyTypeValue('Type', next);
  }

  private getCurrentTypeValue(key = 'Type'): MetadataTypeValue | null {
    const original = this.activeProperties.find((item) => item.key === key);
    if (original?.kind !== 'metadataType') {
      return null;
    }
    return this.normalizeTypeValueForProperty(key, original.value as MetadataTypeValue);
  }

  private applyTypeValue(key: string, typeValue: MetadataTypeValue): void {
    if (!this.activeNode) {
      return;
    }
    const typeTarget = resolveTypeTarget(this.activeNode, key);
    if (!typeTarget) {
      void vscode.window.showWarningMessage('Для выбранного узла изменение типа пока не поддерживается.');
      return;
    }
    const typeInnerXml = key === 'Source'
      ? buildEventSourceInnerXml(typeValue)
      : key === 'CommandParameterType'
      ? buildCommandParameterTypeInnerXml(typeValue)
      : buildMetadataTypeInnerXml(typeValue);
    const typeSaved = this.xmlEditor.modifyObjectType(typeTarget.xmlPath, {
      targetKind: typeTarget.targetKind,
      targetName: typeTarget.targetName,
      tabularSectionName: typeTarget.tabularSectionName,
      propertyName: key === 'Source' ? 'Source' : key === 'CommandParameterType' ? 'CommandParameterType' : 'Type',
      typeInnerXml,
    });
    if (!typeSaved.success) {
      void vscode.window.showErrorMessage(typeSaved.errors[0] ?? 'Не удалось применить изменение типа.');
      return;
    }
    this.host.refreshActiveView();
  }

  private applyPropertyChange(key?: string, value?: string | boolean | string[]): void {
    if (!this.activeNode || !key) {
      return;
    }
    const currentProperty = this.activeProperties.find((item) => item.key === key);
    if (!currentProperty) {
      return;
    }
    if (currentProperty.readonly) {
      this.showReadonlyPropertyWarning(currentProperty);
      return;
    }
    if (
      currentProperty.kind !== 'string' &&
      currentProperty.kind !== 'boolean' &&
      currentProperty.kind !== 'enum' &&
      currentProperty.kind !== 'multiEnum' &&
      currentProperty.kind !== 'localizedString'
    ) {
      return;
    }
    const nextValue = currentProperty.kind === 'boolean'
      ? value === true
      : currentProperty.kind === 'multiEnum'
      ? Array.isArray(value) ? value : []
      : String(value ?? '');
    const currentValue =
      currentProperty.kind === 'boolean'
        ? currentProperty.value === true
        : currentProperty.kind === 'localizedString'
          ? (currentProperty.value as LocalizedStringValue).presentation
          : currentProperty.kind === 'enum'
            ? (currentProperty.value as EnumPropertyValue).current
            : currentProperty.kind === 'multiEnum'
              ? (currentProperty.value as MultiEnumPropertyValue).selected
              : typeof currentProperty.value === 'string'
                ? currentProperty.value
                : '';
    if (arePropertyEditValuesEqual(nextValue, currentValue)) {
      return;
    }
    if (this.isConfigurationRootNode(this.activeNode)) {
      this.applyConfigurationPropertyChange(key, currentProperty, nextValue);
      return;
    }
    const propertyTarget = resolvePropertyTarget(this.activeNode);
    if (!propertyTarget) {
      void vscode.window.showWarningMessage('Для выбранного узла изменение свойств пока не поддерживается.');
      return;
    }
    if (key === 'Name' && isRootObjectNode(this.activeNode, propertyTarget)) {
      if (typeof nextValue !== 'string') {
        return;
      }
      this.renameObject(nextValue);
      return;
    }
    if (currentProperty.kind === 'multiEnum') {
      void vscode.window.showWarningMessage('Изменение этого свойства поддержано только для корня конфигурации.');
      return;
    }
    const valueKind: 'string' | 'boolean' | 'localizedString' = currentProperty.kind === 'enum'
      ? 'string'
      : currentProperty.kind;
    const objectValue = Array.isArray(nextValue)
      ? ''
      : currentProperty.kind === 'string'
      ? toCanonicalPropertyInput(String(nextValue))
      : nextValue;
    const saved = this.xmlEditor.modifyObjectProperty(propertyTarget.xmlPath, {
      targetKind: propertyTarget.targetKind,
      targetName: propertyTarget.targetName,
      tabularSectionName: propertyTarget.tabularSectionName,
      propertyKey: key,
      valueKind,
      value: objectValue,
    });
    if (!saved.success) {
      void vscode.window.showErrorMessage(saved.errors[0] ?? `Не удалось изменить свойство "${key}".`);
      return;
    }
    if (saved.changed) {
      this.host.refreshActiveView();
    }
  }

  private applyConfigurationPropertyChange(
    key: string,
    property: ObjectPropertyItem,
    value: string | boolean | string[]
  ): void {
    if (!this.activeNode?.xmlPath) {
      return;
    }

    const kind = property.kind === 'localizedString'
      ? 'localized'
      : property.kind === 'boolean'
      ? 'boolean'
      : property.kind === 'multiEnum'
      ? 'multiEnum'
      : key === 'DefaultLanguage'
      ? 'reference'
      : 'scalar';

    const scalarValue = typeof value === 'string' && (kind === 'scalar' || kind === 'reference')
      ? toCanonicalPropertyInput(value)
      : value;
    const saved = key === 'DefaultRoles' && Array.isArray(value)
      ? this.xmlEditor.setDefaultRoles(this.activeNode.xmlPath, value)
      : this.xmlEditor.modifyConfigurationProperty(this.activeNode.xmlPath, key, scalarValue, kind);
    if (!saved.success) {
      void vscode.window.showErrorMessage(saved.errors[0] ?? `Не удалось изменить свойство "${key}".`);
      return;
    }
    if (saved.changed) {
      this.host.refreshActiveView();
    }
  }

  private applySubsystemMembershipChange(selectedXmlPaths: string[], showMessage = false): void {
    if (!this.activeNode?.xmlPath) {
      return;
    }
    if (!this.isSubsystemMembershipNode(this.activeNode)) {
      void vscode.window.showWarningMessage('Связь с подсистемами доступна только для корневых объектов метаданных.');
      return;
    }

    const location = getObjectLocationFromXml(this.activeNode.xmlPath);
    const objectRef = `${this.activeNode.nodeKind}.${this.activeNode.textLabel}`;
    const changed = this.subsystemXmlService.setObjectSubsystemMembership(location.configRoot, objectRef, selectedXmlPaths);
    if (changed) {
      this.onAfterSubsystemMembershipSave?.();
    }
    this.host.refreshActiveView();
    if (showMessage) {
      void vscode.window.showInformationMessage(changed
        ? 'Состав подсистем для объекта сохранен.'
        : 'Состав подсистем не изменился.');
    }
  }

  private flattenSubsystemMembershipTree(tree: SubsystemMembershipTreeNode[]): SubsystemMembershipTreeNode[] {
    const result: SubsystemMembershipTreeNode[] = [];
    const walk = (nodes: SubsystemMembershipTreeNode[]): void => {
      for (const node of nodes) {
        result.push(node);
        walk(node.children);
      }
    };
    walk(tree);
    return result;
  }

  private isConfigurationRootNode(node: MetadataNode): boolean {
    return node.nodeKind === 'configuration' || node.nodeKind === 'extension';
  }

  private resolveSubsystemMembershipSnapshot(node: MetadataNode): SubsystemMembershipSnapshot | null {
    if (!this.isSubsystemMembershipNode(node) || !node.xmlPath) {
      return null;
    }
    try {
      const location = getObjectLocationFromXml(node.xmlPath);
      return this.subsystemXmlService.readMembershipSnapshot(
        location.configRoot,
        `${node.nodeKind}.${node.textLabel}`
      );
    } catch {
      return null;
    }
  }

  private resolveExchangePlanContentSnapshot(node: MetadataNode): ExchangePlanContentSnapshot | null {
    if (node.nodeKind !== 'Catalog' || !this.isSubsystemMembershipNode(node) || !node.xmlPath) {
      return null;
    }
    try {
      const location = getObjectLocationFromXml(node.xmlPath);
      return this.exchangePlanContentService.readObjectContentSnapshot(
        location.configRoot,
        `${node.nodeKind}.${node.textLabel}`
      );
    } catch {
      return null;
    }
  }

  private isSubsystemMembershipNode(node: MetadataNode): boolean {
    const target = resolvePropertyTarget(node);
    if (!target || !isRootObjectNode(node, target)) {
      return false;
    }
    if (node.nodeKind === 'Subsystem') {
      return false;
    }
    return Boolean(META_TYPES[node.nodeKind].folder);
  }

  private resolveBasedOnKind(node: MetadataNode): BasedOnMetaKind | null {
    const target = resolvePropertyTarget(node);
    if (!target || !isRootObjectNode(node, target)) {
      return null;
    }
    return node.nodeKind === 'Catalog' || node.nodeKind === 'Document' ? node.nodeKind : null;
  }

  private getRenderTypeValue(property: ObjectPropertyItem): MetadataTypeValue {
    return this.normalizeTypeValueForProperty(property.key, property.value as MetadataTypeValue);
  }

  private normalizeTypeValueForProperty(key: string, value: MetadataTypeValue): MetadataTypeValue {
    return key === 'Type' ? ensureDefaultQualifiers(value) : value;
  }

  private isCurrentTypeReadonly(key = 'Type'): boolean {
    const original = this.activeProperties.find((item) => item.key === key);
    return original?.readonly === true;
  }

  private showReadonlyPropertyWarning(property: ObjectPropertyItem | undefined): void {
    if (property?.inherited) {
      void vscode.window.showWarningMessage('Свойство получено из основной конфигурации. Переопределение через панель свойств пока недоступно.');
      return;
    }
    void vscode.window.showWarningMessage('Это свойство доступно только для чтения.');
  }

  private renameObject(nextName: string): void {
    if (!this.activeNode) {
      return;
    }
    if (this.isEditLockedByRepository(this.activeNode)) {
      void vscode.window.showWarningMessage('Переименование запрещено: объект не захвачен в хранилище.');
      return;
    }
    const target = resolvePropertyTarget(this.activeNode);
    if (!target || !isRootObjectNode(this.activeNode, target)) {
      void vscode.window.showWarningMessage('Переименование доступно только для корневого объекта метаданных.');
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed || !isValidMetadataName(trimmed)) {
      void vscode.window.showErrorMessage('Имя должно начинаться с буквы и содержать только буквы, цифры и "_".');
      return;
    }
    const validation = this.xmlEditor.validateRenameMetadataObject(target.xmlPath, this.activeNode.nodeKind, trimmed);
    if (!validation.success) {
      void vscode.window.showErrorMessage(validation.errors[0] ?? 'Переименование не прошло проверку.');
      return;
    }
    const result = this.xmlEditor.renameMetadataObject(target.xmlPath, this.activeNode.nodeKind, trimmed);
    if (!result.success) {
      void vscode.window.showErrorMessage(result.errors[0] ?? 'Не удалось переименовать объект.');
      return;
    }
    const renamedPath = result.changedFiles
      .filter((item) => item.endsWith('.xml'))
      .find((item) => !item.endsWith('Configuration.xml'));
    if (!renamedPath) {
      void vscode.window.showErrorMessage('Переименование выполнено частично: не найден новый XML-файл объекта.');
      return;
    }

    const oldXmlPath = target.xmlPath;
    this.activeNode = new MetadataNode({
      label: trimmed,
      nodeKind: this.activeNode.nodeKind,
      xmlPath: renamedPath,
      childrenLoader: this.activeNode.childrenLoader,
      ownershipTag: this.activeNode.ownershipTag,
      hidePropertiesCommand: this.activeNode.hidePropertiesCommand,
      metaContext: this.activeNode.metaContext,
    }, this.activeNode.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.activeProperties = [];
    this.host.replaceActiveNode(this.activeNode);
    this.host.refreshActiveView();
    void vscode.window.showInformationMessage('Объект успешно переименован.');

    const location = getObjectLocationFromXml(oldXmlPath);
    this.onAfterRename?.(location.configRoot, oldXmlPath, renamedPath);
  }

  private isEditLockedBySupport(node: MetadataNode): boolean {
    if (!this.supportService) {
      return false;
    }
    const lockMode = this.resolveNodeSupportMode(node);
    return lockMode === SupportMode.Locked;
  }

  private isEditLockedByRepository(node: MetadataNode): boolean {
    if (!this.repositoryService) {
      return false;
    }

    const xmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return false;
    }

    return this.repositoryService.isEditRestricted(xmlPath);
  }

  private resolveEditLockReason(node: MetadataNode): 'support' | 'repository' | undefined {
    if (this.isEditLockedBySupport(node)) {
      return 'support';
    }
    if (this.isEditLockedByRepository(node)) {
      return 'repository';
    }
    return undefined;
  }

  private resolveNodeSupportMode(node: MetadataNode): SupportMode {
    if (!this.supportService) {
      return SupportMode.None;
    }
    const xmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return SupportMode.None;
    }

    const childTagMap: Partial<Record<string, 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource'>> = {
      Attribute: 'Attribute',
      AddressingAttribute: 'AddressingAttribute',
      Dimension: 'Dimension',
      Resource: 'Resource',
    };
    const childTag = childTagMap[node.nodeKind];
    if (childTag) {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const childXml = extractChildMetaElementXml(xml, childTag, node.textLabel);
      const uuid = extractUuidFromXml(childXml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (node.nodeKind === 'Column') {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const columnXml = extractColumnXmlFromTabularSection(xml, node.metaContext?.tabularSectionName ?? '', node.textLabel);
      const uuid = extractUuidFromXml(columnXml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (node.nodeKind === 'SessionParameter' || node.nodeKind === 'CommonAttribute') {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const uuid = extractUuidFromXml(xml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (!xmlPath) {
      return SupportMode.None;
    }
    return this.supportService.getSupportMode(xmlPath);
  }

  /** Преобразует ObjectPropertyItem в PropertyControl для Vue. */
  private toControl(property: ObjectPropertyItem, isEditLocked: boolean): PropertyControl {
    const readonly = isEditLocked || property.readonly === true;
    const base: PropertyControl = {
      id: property.key,
      label: property.title,
      kind: property.kind,
      value: typeof property.value === 'string' || typeof property.value === 'boolean' ? property.value : '',
      readonly,
      inherited: property.inherited ?? false,
    };

    switch (property.kind) {
      case 'enum': {
        const ev = property.value as EnumPropertyValue;
        base.value = ev.current;
        base.options = ev.allowedValues;
        break;
      }
      case 'multiEnum': {
        const mv = property.value as MultiEnumPropertyValue;
        base.selected = mv.selected;
        base.options = mv.allowedValues;
        base.value = mv.selected;
        break;
      }
      case 'localizedString': {
        const lv = property.value as LocalizedStringValue;
        base.value = lv.presentation;
        break;
      }
      case 'metadataType': {
        const tv = property.key === 'Type'
          ? ensureDefaultQualifiers(property.value as MetadataTypeValue)
          : property.value as MetadataTypeValue;
        base.typePresentation = tv.presentation;
        base.typeItems = tv.items;
        base.stringQualifiers = tv.stringQualifiers ?? null;
        base.numberQualifiers = tv.numberQualifiers ?? null;
        base.dateQualifiers = tv.dateQualifiers ?? null;
        base.value = tv;
        break;
      }
      case 'metadataReferenceList': {
        const rv = property.value as MetadataReferenceListValue;
        base.referenceItems = rv.items;
        base.value = rv;
        break;
      }
    }

    return base;
  }

  /** Группирует контролы в секции по section/sectionOrder исходных свойств. */
  private groupIntoSections(
    controls: PropertyControl[],
    properties: ObjectPropertiesCollection
  ): PropertySection[] {
    const sectionMap = new Map<string, { order: number; controls: PropertyControl[] }>();

    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      const sectionName = prop.section ?? 'Свойства';
      const existing = sectionMap.get(sectionName);
      if (existing) {
        existing.controls.push(controls[i]);
      } else {
        sectionMap.set(sectionName, {
          order: prop.sectionOrder ?? Number.MAX_SAFE_INTEGER,
          controls: [controls[i]],
        });
      }
    }

    return Array.from(sectionMap.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([title, data]) => ({
        title,
        order: data.order,
        controls: data.controls,
      }));
  }
}
