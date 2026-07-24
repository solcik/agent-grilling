import * as Markdown from '@foldkit/markdown'
import { Option } from 'effect'

const headingPattern = /^(#{1,6})\s+(.*)$/
const unorderedItemPattern = /^\s*[-*+]\s+(.*)$/
const orderedItemPattern = /^\s*(\d+)\.\s+(.*)$/
const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
const linkPattern = /^\[([^\]]+)\]\(([^)]+)\)$/
const tableDelimiterPattern = /^:?-{3,}:?$/
const headingLevels = [1, 2, 3, 4, 5, 6] as const

export const parseMarkdown = (source: string): Markdown.MarkdownDocument => {
  const lines = source.replace(/\r/g, '').split('\n')
  const blocks: Array<Markdown.Block> = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const heading = headingPattern.exec(line)

    if (line.trim() === '') {
      index += 1
    } else if (line.startsWith('```')) {
      const codeBlock = parseCodeBlock(lines, index)
      blocks.push(codeBlock.block)
      index = codeBlock.nextIndex
    } else if (heading !== null) {
      blocks.push(
        Markdown.Heading({
          level: headingLevels[(heading[1] ?? '#').length - 1] ?? 1,
          content: parseInlineMarkdown(heading[2] ?? ''),
        }),
      )
      index += 1
    } else if (unorderedItemPattern.test(line)) {
      const list = parseList(lines, index, unorderedItemPattern, false)
      blocks.push(list.block)
      index = list.nextIndex
    } else if (orderedItemPattern.test(line)) {
      const list = parseList(lines, index, orderedItemPattern, true)
      blocks.push(list.block)
      index = list.nextIndex
    } else if (isTableStart(lines, index)) {
      const table = parseTable(lines, index)
      blocks.push(table.block)
      index = table.nextIndex
    } else {
      const paragraph = parseParagraph(lines, index)
      blocks.push(paragraph.block)
      index = paragraph.nextIndex
    }
  }

  return Markdown.MarkdownDocument.make({ blocks })
}

type ParsedBlock<Block extends Markdown.Block> = Readonly<{
  block: Block
  nextIndex: number
}>

const parseCodeBlock = (
  lines: ReadonlyArray<string>,
  startIndex: number,
): ParsedBlock<Markdown.CodeBlock> => {
  const info = (lines[startIndex] ?? '').slice(3).trim()
  const [language, ...metaParts] = info.split(/\s+/)
  const code: Array<string> = []
  let index = startIndex + 1

  while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
    code.push(lines[index] ?? '')
    index += 1
  }

  return {
    block: Markdown.CodeBlock({
      maybeLanguage: Option.fromNullishOr(language === '' ? undefined : language),
      maybeMeta: Option.fromNullishOr(metaParts.length === 0 ? undefined : metaParts.join(' ')),
      value: code.join('\n'),
    }),
    nextIndex: index < lines.length ? index + 1 : index,
  }
}

const parseList = (
  lines: ReadonlyArray<string>,
  startIndex: number,
  itemPattern: RegExp,
  isOrdered: boolean,
): ParsedBlock<Markdown.List> => {
  const firstMatch = itemPattern.exec(lines[startIndex] ?? '')
  const items: [Markdown.ListItem, ...Array<Markdown.ListItem>] = [
    listItem(firstMatch?.[isOrdered ? 2 : 1] ?? ''),
  ]
  let index = startIndex + 1

  while (index < lines.length) {
    const match = itemPattern.exec(lines[index] ?? '')
    if (match === null) break
    items.push(listItem(match[isOrdered ? 2 : 1] ?? ''))
    index += 1
  }

  return {
    block: Markdown.List({
      isOrdered,
      maybeStartNumber: isOrdered
        ? Option.some(Number.parseInt(firstMatch?.[1] ?? '1', 10))
        : Option.none(),
      items,
    }),
    nextIndex: index,
  }
}

const listItem = (source: string): Markdown.ListItem =>
  Markdown.ListItem({
    blocks: [Markdown.Paragraph({ content: parseInlineMarkdown(source) })],
  })

const isTableStart = (lines: ReadonlyArray<string>, index: number): boolean => {
  const header = lines[index] ?? ''
  const delimiterCells = tableCells(lines[index + 1] ?? '')
  return (
    header.includes('|') &&
    delimiterCells.length > 0 &&
    delimiterCells.every(cell => tableDelimiterPattern.test(cell))
  )
}

const parseTable = (
  lines: ReadonlyArray<string>,
  startIndex: number,
): ParsedBlock<Markdown.Table> => {
  const alignments = tableCells(lines[startIndex + 1] ?? '').map(tableAlignment)
  const bodyRows: Array<Markdown.TableRow> = []
  let index = startIndex + 2

  while (index < lines.length && (lines[index] ?? '').includes('|')) {
    bodyRows.push(tableRow(lines[index] ?? ''))
    index += 1
  }

  return {
    block: Markdown.Table({
      alignments,
      headerRow: tableRow(lines[startIndex] ?? ''),
      bodyRows,
    }),
    nextIndex: index,
  }
}

const tableRow = (line: string): Markdown.TableRow =>
  Markdown.TableRow({
    cells: tableCells(line).map(cell => Markdown.TableCell({ content: parseInlineMarkdown(cell) })),
  })

const tableCells = (line: string): Array<string> =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

const tableAlignment = (delimiter: string): Markdown.Alignment => {
  if (delimiter.startsWith(':') && delimiter.endsWith(':')) return 'Center'
  if (delimiter.startsWith(':')) return 'Left'
  if (delimiter.endsWith(':')) return 'Right'
  return 'None'
}

const parseParagraph = (
  lines: ReadonlyArray<string>,
  startIndex: number,
): ParsedBlock<Markdown.Paragraph> => {
  const paragraph = [lines[startIndex] ?? '']
  let index = startIndex + 1

  while (
    index < lines.length &&
    (lines[index] ?? '').trim() !== '' &&
    !isInterruptingBlock(lines[index] ?? '')
  ) {
    paragraph.push(lines[index] ?? '')
    index += 1
  }

  return {
    block: Markdown.Paragraph({
      content: parseInlineMarkdown(paragraph.join(' ')),
    }),
    nextIndex: index,
  }
}

const isInterruptingBlock = (line: string): boolean =>
  line.startsWith('```') ||
  headingPattern.test(line) ||
  unorderedItemPattern.test(line) ||
  orderedItemPattern.test(line)

const parseInlineMarkdown = (source: string): ReadonlyArray<Markdown.Inline> => {
  const content: Array<Markdown.Inline> = []
  let index = 0

  for (const match of source.matchAll(inlinePattern)) {
    if (match.index > index) {
      content.push(Markdown.Text({ value: source.slice(index, match.index) }))
    }
    content.push(inlineNode(match[0]))
    index = match.index + match[0].length
  }

  if (index < source.length) {
    content.push(Markdown.Text({ value: source.slice(index) }))
  }

  return content
}

const inlineNode = (token: string): Markdown.Inline => {
  if (token.startsWith('`')) {
    return Markdown.InlineCode({ value: token.slice(1, -1) })
  }
  if (token.startsWith('**')) {
    return Markdown.Strong({
      content: [Markdown.Text({ value: token.slice(2, -2) })],
    })
  }
  if (token.startsWith('*')) {
    return Markdown.Emphasis({
      content: [Markdown.Text({ value: token.slice(1, -1) })],
    })
  }

  const link = linkPattern.exec(token)
  return Markdown.Link({
    url: link?.[2] ?? '',
    maybeTitle: Option.none(),
    content: [Markdown.Text({ value: link?.[1] ?? '' })],
  })
}
