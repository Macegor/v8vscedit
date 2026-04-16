import * as vscode from 'vscode';
import { MetadataNode } from '../MetadataNode';

/** Хранит выбранный узел для панели свойств */
export class PropertiesSelectionService {
  private readonly didChangeSelectedNodeEmitter = new vscode.EventEmitter<MetadataNode | undefined>();
  readonly onDidChangeSelectedNode = this.didChangeSelectedNodeEmitter.event;

  private selectedNode: MetadataNode | undefined;

  /** Возвращает текущий выбранный узел */
  getSelectedNode(): MetadataNode | undefined {
    return this.selectedNode;
  }

  /** Обновляет выбранный узел и уведомляет подписчиков */
  setSelectedNode(node: MetadataNode | undefined): void {
    this.selectedNode = node;
    this.didChangeSelectedNodeEmitter.fire(node);
  }

  /** Освобождает ресурсы сервиса */
  dispose(): void {
    this.didChangeSelectedNodeEmitter.dispose();
  }
}
