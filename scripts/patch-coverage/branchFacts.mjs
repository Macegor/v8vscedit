// Факты о ветвлениях в исходнике — независимый от c8 источник правды для гейта
// patch-покрытия: сколько ветвлений РЕАЛЬНО есть в затронутых строках.
// Нужен потому, что плоская (не поблочная) запись покрытия выглядит как
// «функция покрыта целиком со всеми ветками»: в прежнем полном прогоне из 263
// файлов lcov записи BRDA были лишь у 85, и по остальным 178 гейт выносил
// вердикт «ветки покрыты», не имея о них ни одного факта.
//
// Разбор — только TypeScript AST (никаких регулярок по тексту): строка,
// комментарий и regex-литерал не должны маскироваться под конструкцию.
//
// ИНВАРИАНТ: детектор обязан НЕДООЦЕНИВАТЬ. Пропущенное ветвление — гейт
// промолчит (не хуже сегодняшнего поведения), а лишнее найденное — вечный
// неисправимый красный: закрыть тестом ветку, которой нет в JS, невозможно.
// Поэтому список конструкций консервативный, а условный ТИП
// (`T extends X ? A : B`) в него не входит — он в JS вообще не эмитится.
import ts from 'typescript';

/** Операторы, которые эмитятся в JS как ветвление (короткое замыкание). */
const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * Диапазоны строк ветвлений исходника.
 *
 * Диапазон — это то место, куда `v8-to-istanbul` реально кладёт запись BRDA,
 * а не то, где конструкция начинается. Для `if` и для тернарника/логической
 * операции это заголовок (условие, всё выражение); для `switch` — НЕ заголовок
 * `switch (x)`, а каждая `case`-клауза ОТДЕЛЬНЫМ диапазоном, потому что записи
 * V8 стоят именно на клаузах. Тело в диапазон не входит никогда: телом
 * ветвление не является, и его строки расширили бы зону проверки на
 * посторонний код.
 *
 * Замерено на реальном отчёте: при диапазоне-заголовке `switch` давал 1
 * попадание BRDA против 20 промахов, то есть любая правка строки `switch (x)`
 * порождала требование данных, которых V8 туда не кладёт в принципе, — красный,
 * не закрываемый ни тестом, ни `c8 ignore`. После перехода на клаузы — 235
 * попаданий против 7. Поэтому НЕ возвращать диапазон к заголовку.
 *
 * @param {string} text исходный текст файла
 * @param {string} fileName имя файла (определяет ScriptKind: .ts/.mjs/.js)
 * @returns {{startLine:number,endLine:number,kind:'if'|'conditional'|'logical'|'switch'}[]}
 */
export function branchRangesOfSource(text, fileName) {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true);
  const found = [];
  collect(sourceFile, sourceFile, found);
  return found;
}

/** Обход в прямом порядке: внешняя конструкция раньше вложенной в неё. */
function collect(node, sourceFile, out) {
  const range = rangeOf(node, sourceFile);
  if (range !== undefined) {
    out.push(range);
  }
  node.forEachChild((child) => {
    collect(child, sourceFile, out);
  });
}

function rangeOf(node, sourceFile) {
  if (ts.isIfStatement(node)) {
    // Конец диапазона — конец УСЛОВИЯ, а не всего оператора: иначе в зону
    // проверки попало бы тело со всеми своими строками.
    return makeRange(node, node.expression, 'if', sourceFile);
  }
  if (ts.isConditionalExpression(node)) {
    return makeRange(node, node, 'conditional', sourceFile);
  }
  if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
    return makeRange(node, node, 'logical', sourceFile);
  }
  // Диапазон switch — это КАЖДАЯ case-клауза по отдельности, а НЕ заголовок
  // `switch (x)`: v8-to-istanbul кладёт записи BRDA на строки самих клауз.
  // Замерено на реальном coverage/lcov.info (295 файлов): диапазон-заголовок
  // попал в BRDA 1 раз против 25 промахов, и то попадание — запись соседней
  // конструкции. Такой красный невозможно закрыть тестом (записи на строке
  // заголовка V8 не создаёт в принципе), то есть гейт пришлось бы обходить.
  // `default` НЕ включён намеренно: его поведение не замерено, а лишний
  // диапазон без источника BRDA — это неисправимый ложный красный.
  // Отдельная ветка на switch-узел не нужна: switch без case (пустой или
  // только с `default`) просто не содержит ни одной CaseClause.
  if (ts.isCaseClause(node)) {
    return makeRange(node, node.expression, 'switch', sourceFile);
  }
  return undefined;
}

function makeRange(startNode, endNode, kind, sourceFile) {
  return {
    // getStart пропускает ведущие комментарии — иначе диапазон начинался бы с
    // строки комментария над конструкцией.
    startLine: lineOf(startNode.getStart(sourceFile), sourceFile),
    endLine: lineOf(endNode.getEnd(), sourceFile),
    kind,
  };
}

function lineOf(position, sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}
