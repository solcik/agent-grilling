import * as Markdown from '@foldkit/markdown'
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { parseMarkdown } from './markdown.js'

const expectSchemaValid = (document: Markdown.MarkdownDocument): void => {
  expect(Markdown.decodeDocument(Markdown.encodeDocument(document))).toStrictEqual(document)
}

describe('parseMarkdown', () => {
  test('parses headings, paragraphs, and the supported inline syntax', () => {
    const document = parseMarkdown(
      [
        '## Runtime context',
        '',
        'Plain **bold** and *italic* with `code` and [a link](https://example.com).',
      ].join('\n'),
    )

    expect(document).toStrictEqual({
      blocks: [
        Markdown.Heading({
          level: 2,
          content: [Markdown.Text({ value: 'Runtime context' })],
        }),
        Markdown.Paragraph({
          content: [
            Markdown.Text({ value: 'Plain ' }),
            Markdown.Strong({
              content: [Markdown.Text({ value: 'bold' })],
            }),
            Markdown.Text({ value: ' and ' }),
            Markdown.Emphasis({
              content: [Markdown.Text({ value: 'italic' })],
            }),
            Markdown.Text({ value: ' with ' }),
            Markdown.InlineCode({ value: 'code' }),
            Markdown.Text({ value: ' and ' }),
            Markdown.Link({
              url: 'https://example.com',
              maybeTitle: Option.none(),
              content: [Markdown.Text({ value: 'a link' })],
            }),
            Markdown.Text({ value: '.' }),
          ],
        }),
      ],
    })
    expectSchemaValid(document)
  })

  test('parses unordered and ordered lists into non-empty list items', () => {
    const document = parseMarkdown(['- First', '* Second', '', '3. Third', '4. Fourth'].join('\n'))

    expect(document).toStrictEqual({
      blocks: [
        Markdown.List({
          isOrdered: false,
          maybeStartNumber: Option.none(),
          items: [
            Markdown.ListItem({
              blocks: [
                Markdown.Paragraph({
                  content: [Markdown.Text({ value: 'First' })],
                }),
              ],
            }),
            Markdown.ListItem({
              blocks: [
                Markdown.Paragraph({
                  content: [Markdown.Text({ value: 'Second' })],
                }),
              ],
            }),
          ],
        }),
        Markdown.List({
          isOrdered: true,
          maybeStartNumber: Option.some(3),
          items: [
            Markdown.ListItem({
              blocks: [
                Markdown.Paragraph({
                  content: [Markdown.Text({ value: 'Third' })],
                }),
              ],
            }),
            Markdown.ListItem({
              blocks: [
                Markdown.Paragraph({
                  content: [Markdown.Text({ value: 'Fourth' })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
    expectSchemaValid(document)
  })

  test('parses pipe tables with alignment and inline cell content', () => {
    const document = parseMarkdown(
      ['| Name | Value | Notes |', '| :--- | ---: | :---: |', '| **Alpha** | `1` | *Good* |'].join(
        '\n',
      ),
    )

    expect(document).toStrictEqual({
      blocks: [
        Markdown.Table({
          alignments: ['Left', 'Right', 'Center'],
          headerRow: Markdown.TableRow({
            cells: [
              Markdown.TableCell({
                content: [Markdown.Text({ value: 'Name' })],
              }),
              Markdown.TableCell({
                content: [Markdown.Text({ value: 'Value' })],
              }),
              Markdown.TableCell({
                content: [Markdown.Text({ value: 'Notes' })],
              }),
            ],
          }),
          bodyRows: [
            Markdown.TableRow({
              cells: [
                Markdown.TableCell({
                  content: [
                    Markdown.Strong({
                      content: [Markdown.Text({ value: 'Alpha' })],
                    }),
                  ],
                }),
                Markdown.TableCell({
                  content: [Markdown.InlineCode({ value: '1' })],
                }),
                Markdown.TableCell({
                  content: [
                    Markdown.Emphasis({
                      content: [Markdown.Text({ value: 'Good' })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
    expectSchemaValid(document)
  })
})
