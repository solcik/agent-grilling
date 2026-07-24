import { Schema } from 'effect'

import { Answer, Inbox, Round } from './domain/contract.js'

export const richRoundInput = {
  roundId: 'round-rich',
  title: 'Choose a direction',
  intro: 'Compare the options before deciding.',
  context: [
    { kind: 'markdown', text: '## Context\n\n**Important** detail.' },
    { kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: 'Diagram' },
    { kind: 'html', html: '<h1>Isolated preview</h1>' },
  ],
  questions: [
    {
      id: 'direction',
      header: 'Architecture',
      question: 'Which direction should we take?',
      context: [{ kind: 'markdown', text: '- Fast\n- Maintainable' }],
      options: [
        {
          label: 'Repository',
          description: 'Keep persistence behind a seam.',
          recommended: true,
          preview: { kind: 'html', html: '<p>Repository preview</p>' },
        },
        {
          label: 'Direct filesystem',
          preview: { kind: 'image', src: '/attachments/example', caption: 'Alternative' },
        },
      ],
      allowOther: true,
      allowNotes: true,
    },
    {
      id: 'features',
      question: 'Which features belong in the first slice?',
      multiSelect: true,
      options: [
        { label: 'Server', recommended: true },
        { label: 'CLI', recommended: true },
      ],
    },
  ],
}

export const richRound = Schema.decodeUnknownSync(Round)(richRoundInput)

export const answer = Schema.decodeUnknownSync(Answer)({
  sessionId: 'acme/grill',
  roundId: richRound.roundId,
  submittedAt: '2026-07-24T12:00:00.000Z',
  answers: {
    direction: { selected: ['Repository'], other: null, notes: 'A clear seam.' },
    features: { selected: ['Server', 'CLI'] },
  },
})

export const inbox = Schema.decodeUnknownSync(Inbox)({
  sessions: [
    {
      sessionId: 'acme/grill',
      roundId: richRound.roundId,
      title: richRound.title,
      count: richRound.questions.length,
      answered: false,
    },
  ],
})
