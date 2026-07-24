import { Option, Result } from 'effect'
import { Story } from 'foldkit'
import { describe, expect, test, vi } from 'vitest'

import type { Inbox, Round } from '../domain/contract.js'
import { FetchRound } from './command.js'
import { ClickedOption, ClickedSession, SettledFetchInbox, SettledFetchRound } from './message.js'
import { InboxData, type Model, RoundData } from './model.js'
import { init, update } from './update.js'

const firstSessionId = 'acme/first'
const secondSessionId = 'acme/second'

const firstRound: Round = {
  roundId: 'round-first',
  title: 'First round',
  questions: [
    {
      id: 'single-choice',
      question: 'Choose one',
      options: [{ label: 'Alpha' }, { label: 'Beta' }],
    },
    {
      id: 'multiple-choice',
      question: 'Choose several',
      multiSelect: true,
      options: [{ label: 'Red' }, { label: 'Blue' }],
    },
  ],
}

const secondRound: Round = {
  roundId: 'round-second',
  title: 'Second round',
  questions: [
    {
      id: 'second-question',
      question: 'A question unique to the second round',
      options: [{ label: 'Continue', recommended: true }],
    },
  ],
}

const twoSessionInbox: Inbox = {
  sessions: [
    {
      sessionId: firstSessionId,
      roundId: firstRound.roundId,
      title: 'First session',
      count: firstRound.questions.length,
      answered: false,
    },
    {
      sessionId: secondSessionId,
      roundId: secondRound.roundId,
      title: 'Second session',
      count: secondRound.questions.length,
      answered: false,
    },
  ],
}

const emptyModel: Model = {
  inbox: InboxData.Loading(),
  activeSessionId: Option.none(),
  round: RoundData.Idle(),
  answers: {},
  isLight: false,
}

const firstRoundModel: Model = {
  inbox: InboxData.Success({ data: twoSessionInbox }),
  activeSessionId: Option.some(firstSessionId),
  round: RoundData.Success({ data: firstRound }),
  answers: {
    'single-choice': { selected: ['Alpha'], other: '', notes: '' },
    'multiple-choice': { selected: ['Red'], other: '', notes: '' },
  },
  isLight: false,
}

describe('init', () => {
  test('uses theme flags without reading localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    try {
      const [model] = init({ isLight: true })

      expect(model.isLight).toBe(true)
      expect(getItem).not.toHaveBeenCalled()
    } finally {
      getItem.mockRestore()
    }
  })
})

describe('update', () => {
  test('settled inbox auto-selects the first unanswered session and fetches its round', () => {
    const fetchFirstRound = FetchRound({ sessionId: firstSessionId })

    Story.story(
      update,
      Story.with(emptyModel),
      Story.message(SettledFetchInbox({ result: Result.succeed(twoSessionInbox) })),
      Story.model(model => {
        expect(model.activeSessionId).toStrictEqual(Option.some(firstSessionId))
        expect(model.inbox).toStrictEqual(InboxData.Success({ data: twoSessionInbox }))
        expect(model.round).toStrictEqual(RoundData.Loading())
      }),
      Story.Command.expectExact(fetchFirstRound),
      Story.Command.resolve(
        fetchFirstRound,
        SettledFetchRound({
          sessionId: firstSessionId,
          result: Result.succeed(firstRound),
        }),
      ),
    )
  })

  test('ClickedSession switches the active session, loads the round, and fetches the clicked session', () => {
    const fetchSecondRound = FetchRound({ sessionId: secondSessionId })

    Story.story(
      update,
      Story.with(firstRoundModel),
      Story.message(ClickedSession({ sessionId: secondSessionId })),
      Story.model(model => {
        expect(model.activeSessionId).toStrictEqual(Option.some(secondSessionId))
        expect(model.round).toStrictEqual(RoundData.Loading())
      }),
      Story.Command.expectExact(fetchSecondRound),
      Story.Command.resolve(
        fetchSecondRound,
        SettledFetchRound({
          sessionId: secondSessionId,
          result: Result.succeed(secondRound),
        }),
      ),
    )
  })

  test('settled round displays its data and makes its session active', () => {
    Story.story(
      update,
      Story.with(emptyModel),
      Story.message(
        SettledFetchRound({
          sessionId: secondSessionId,
          result: Result.succeed(secondRound),
        }),
      ),
      Story.model(model => {
        expect(model.activeSessionId).toStrictEqual(Option.some(secondSessionId))
        expect(model.round).toStrictEqual(RoundData.Success({ data: secondRound }))
      }),
      Story.Command.expectNone(),
    )
  })

  test('ClickedOption replaces a single-select answer', () => {
    Story.story(
      update,
      Story.with(firstRoundModel),
      Story.message(ClickedOption({ questionId: 'single-choice', label: 'Beta' })),
      Story.model(model => {
        expect(model.answers['single-choice']?.selected).toStrictEqual(['Beta'])
      }),
      Story.Command.expectNone(),
    )
  })

  test('ClickedOption toggles labels in a multi-select answer', () => {
    Story.story(
      update,
      Story.with(firstRoundModel),
      Story.message(ClickedOption({ questionId: 'multiple-choice', label: 'Blue' })),
      Story.model(model => {
        expect(model.answers['multiple-choice']?.selected).toStrictEqual(['Red', 'Blue'])
      }),
      Story.message(ClickedOption({ questionId: 'multiple-choice', label: 'Red' })),
      Story.model(model => {
        expect(model.answers['multiple-choice']?.selected).toStrictEqual(['Blue'])
      }),
      Story.Command.expectNone(),
    )
  })
})
