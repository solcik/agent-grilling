import { Option, Result } from 'effect'
import { Scene } from 'foldkit'
import { describe, expect, test } from 'vitest'

import type { Inbox, Round } from '../domain/contract.js'
import { FetchRound } from './command.js'
import { SettledFetchRound } from './message.js'
import { InboxData, type Model, RoundData } from './model.js'
import { update } from './update.js'
import { view } from './view.js'

const firstSessionId = 'acme/first'
const secondSessionId = 'acme/second'

const firstRound: Round = {
  roundId: 'round-first',
  title: 'First round title',
  questions: [
    {
      id: 'first-question',
      question: 'A question unique to the first round',
      options: [{ label: 'Stay' }],
    },
  ],
}

const secondRound: Round = {
  roundId: 'round-second',
  title: 'Second round title',
  questions: [
    {
      id: 'second-question',
      question: 'A question unique to the second round',
      options: [{ label: 'Switch' }],
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

const modelShowingFirstRound: Model = {
  inbox: InboxData.Success({ data: twoSessionInbox }),
  activeSessionId: Option.some(firstSessionId),
  round: RoundData.Success({ data: firstRound }),
  answers: {
    'first-question': { selected: [], other: '', notes: '' },
  },
  isLight: false,
}

describe('view interactions', () => {
  test('clicking the second session replaces the first session round', () => {
    const secondSessionButton = Scene.within(
      Scene.role('navigation', { name: 'Sessions' }),
      Scene.text('Second session'),
    )
    const fetchSecondRound = FetchRound({ sessionId: secondSessionId })

    Scene.scene(
      { update, view },
      Scene.with(modelShowingFirstRound),
      Scene.expect(Scene.text('First round title')).toExist(),
      Scene.expect(Scene.text('A question unique to the first round')).toExist(),
      Scene.click(secondSessionButton),
      Scene.Command.expectExact(fetchSecondRound),
      Scene.Command.resolve(
        fetchSecondRound,
        SettledFetchRound({
          sessionId: secondSessionId,
          result: Result.succeed(secondRound),
        }),
      ),
      Scene.expect(Scene.text('Second round title')).toExist(),
      Scene.expect(Scene.text('A question unique to the second round')).toExist(),
      Scene.expect(Scene.text('First round title')).not.toExist(),
      Scene.expect(Scene.text('A question unique to the first round')).not.toExist(),
      // Scene renders fresh VNodes rather than running the DOM patcher. Assert
      // keyed row identity explicitly so this regression still fails without it.
      Scene.tap(({ html }) => {
        const pending = [html]
        const sessionRowKeys: Array<PropertyKey | undefined> = []
        while (pending.length > 0) {
          const node = pending.shift()
          if (node === undefined) continue
          if (node.sel === 'button' && node.data?.class?.['session-row'] === true) {
            sessionRowKeys.push(node.key)
          }
          for (const child of node.children ?? []) {
            if (typeof child !== 'string') pending.push(child)
          }
        }
        expect(sessionRowKeys).toStrictEqual([firstSessionId, secondSessionId])
      }),
    )
  })

  test('a failed round renders its error and retries the active session', () => {
    const error = 'Could not load this round.'
    const fetchFirstRound = FetchRound({ sessionId: firstSessionId })
    const failedModel: Model = {
      ...modelShowingFirstRound,
      round: RoundData.Failure({ error }),
    }

    Scene.scene(
      { update, view },
      Scene.with(failedModel),
      Scene.expect(Scene.text(error)).toExist(),
      Scene.click(Scene.role('button', { name: 'Retry' })),
      Scene.expect(Scene.text('Loading round…')).toExist(),
      Scene.Command.expectExact(fetchFirstRound),
      Scene.Command.resolve(
        fetchFirstRound,
        SettledFetchRound({
          sessionId: firstSessionId,
          result: Result.succeed(firstRound),
        }),
      ),
      Scene.expect(Scene.text('First round title')).toExist(),
    )
  })
})
