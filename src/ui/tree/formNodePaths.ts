import { resolveChildFormXml, resolveFormXmlByDescriptor } from '../../infra/fs/MetaPathResolver';
import type { MetadataNode } from './TreeNode';

/**
 * Деривация «узел дерева формы → файлы формы». ОДНА на всех потребителей:
 * MCP-резолверы (`ui/mcp/McpPathResolvers`) и команды навигатора
 * (`ui/commands/form/FormToolsCommands`) обязаны для одного действия ходить
 * одним кодом (CLAUDE.md, раздел про MCP).
 *
 * Зачем отдельный модуль: `node.xmlPath` у формы ОБЪЕКТА — это XML
 * объекта-владельца (сознательный адрес открытия по клику, `resolveLeafXmlPath`),
 * а не путь формы. Оба потребителя независимо принимали его за путь формы и
 * разбирали XML справочника как Form.xml. Общая форма при этом «работала»
 * (у неё `xmlPath` — дескриптор), из-за чего дефект выглядел плавающим.
 *
 * Место — `ui/tree/`, потому что это адаптер над `MetadataNode`: положить его в
 * `ui/mcp/` значило бы сделать команды навигатора зависимыми от MCP-слоя,
 * который сам лишь потребитель дерева.
 */

/** Разбор узла формы объекта: чем владеет форма и как она называется. */
export interface ObjectFormNodeParts {
  /** XML объекта-владельца формы (`Catalogs/Товары.xml`). */
  readonly ownerObjectXmlPath: string;
  /** Имя формы — как в `<ChildObjects><Form>` и в имени дескриптора. */
  readonly formName: string;
}

/**
 * Единая точка правды «что такое узел формы объекта»: возвращает XML владельца и
 * имя формы. Общая форма и любой не-формовый вид узла отбиваются — у них нет
 * объекта-владельца, и операции состава (например удаление формы) к ним неприменимы.
 *
 * `label` — как называть узел в сообщении об ошибке (канонический путь у MCP,
 * имя узла у команды навигатора).
 */
export function resolveObjectFormNodeParts(node: MetadataNode, label: string): ObjectFormNodeParts {
  if (node.nodeKind !== 'Form') {
    throw new Error(
      `Путь "${label}" должен указывать на форму объекта (Справочники.X.Форма.Y), ` +
      `получено ${node.nodeKind}.`,
    );
  }
  const ownerObjectXmlPath = node.metaContext?.ownerObjectXmlPath;
  if (!ownerObjectXmlPath) {
    throw new Error(
      `У формы "${label}" не определён объект-владелец (ownerObjectXmlPath): ` +
      'путь к телу формы построить нечем.',
    );
  }
  return { ownerObjectXmlPath, formName: node.textLabel };
}

/**
 * Путь к ТЕЛУ формы (`…/Ext/Form.xml`) по узлу дерева. Тело считается арифметикой
 * `MetaPathResolver`: у общей формы `xmlPath` — дескриптор `CommonForms/X.xml`,
 * у формы объекта — XML владельца плюс имя узла.
 */
export function resolveFormBodyFromNode(node: MetadataNode, label: string): string {
  if (node.nodeKind === 'CommonForm') {
    if (!node.xmlPath) {
      throw new Error(`Форма "${label}" не имеет XML-файла.`);
    }
    return resolveFormXmlByDescriptor(node.xmlPath);
  }
  if (node.nodeKind === 'Form') {
    const { ownerObjectXmlPath, formName } = resolveObjectFormNodeParts(node, label);
    return resolveChildFormXml(ownerObjectXmlPath, formName);
  }
  throw new Error(
    `Путь "${label}" должен указывать на форму (Справочники.X.Форма.Y или ОбщиеФормы.X), ` +
    `получено ${node.nodeKind}.`,
  );
}
