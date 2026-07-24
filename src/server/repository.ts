import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'

import { Answer, Inbox, Round, SessionRow } from '../domain/contract.js'
import type { Round as RoundType } from '../domain/contract.js'

const StoredSession = Schema.Struct({ sessionId: Schema.String })

export class InvalidAnswerError extends Error {}

export class StateRepository {
  readonly sessionsDirectory: string

  constructor(readonly stateDirectory: string) {
    this.sessionsDirectory = join(stateDirectory, 'sessions')
  }

  async postRound(sessionId: string, round: RoundType): Promise<RoundType> {
    this.assertSessionId(sessionId)
    const directory = this.sessionDirectory(sessionId)
    await mkdir(directory, { recursive: true })
    await this.writeJson(join(directory, 'session.json'), StoredSession, { sessionId })
    await this.writeJson(join(directory, 'round.json'), Round, round)
    await rm(join(directory, 'answer.json'), { force: true })
    return round
  }

  async getRound(sessionId: string): Promise<RoundType | undefined> {
    this.assertSessionId(sessionId)
    return this.readJson(join(this.sessionDirectory(sessionId), 'round.json'), Round)
  }

  async postAnswer(answer: Answer): Promise<Answer> {
    this.assertSessionId(answer.sessionId)
    const round = await this.getRound(answer.sessionId)
    if (round === undefined) {
      throw new MissingRoundError()
    }
    this.assertAnswer(round, answer)
    const submitted = Schema.decodeUnknownSync(Answer)({
      ...answer,
      submittedAt: answer.submittedAt ?? new Date().toISOString(),
    })
    await this.writeJson(
      join(this.sessionDirectory(answer.sessionId), 'answer.json'),
      Answer,
      submitted,
    )
    return submitted
  }

  async getAnswer(sessionId: string): Promise<Answer | undefined> {
    this.assertSessionId(sessionId)
    return this.readJson(join(this.sessionDirectory(sessionId), 'answer.json'), Answer)
  }

  async getInbox() {
    let directoryNames: Array<string>
    try {
      directoryNames = await readdir(this.sessionsDirectory)
    } catch (error) {
      if (isMissingFileError(error)) {
        return Schema.decodeUnknownSync(Inbox)({ sessions: [] })
      }
      throw error
    }

    const rows = await Promise.all(
      directoryNames.map(async directoryName => {
        const directory = join(this.sessionsDirectory, directoryName)
        const storedSession = await this.readJson(join(directory, 'session.json'), StoredSession)
        const round = await this.readJson(join(directory, 'round.json'), Round)
        if (storedSession === undefined || round === undefined) {
          return undefined
        }
        const answer = await this.readJson(join(directory, 'answer.json'), Answer)
        return Schema.decodeUnknownSync(SessionRow)({
          sessionId: storedSession.sessionId,
          roundId: round.roundId,
          title: round.title ?? `Round ${round.roundId}`,
          count: round.questions.length,
          answered: answer?.roundId === round.roundId,
        })
      }),
    )
    const sessions = rows
      .filter((row): row is SessionRow => row !== undefined)
      .sort(
        (left, right) =>
          Number(left.answered) - Number(right.answered) ||
          left.sessionId.localeCompare(right.sessionId),
      )
    return Schema.decodeUnknownSync(Inbox)({ sessions })
  }

  async reset(sessionId: string): Promise<void> {
    this.assertSessionId(sessionId)
    await rm(this.sessionDirectory(sessionId), { recursive: true, force: true })
  }

  private sessionDirectory(sessionId: string): string {
    return join(this.sessionsDirectory, Buffer.from(sessionId).toString('base64url'))
  }

  private assertSessionId(sessionId: string): void {
    if (sessionId.trim() === '') {
      throw new InvalidAnswerError('A session id is required.')
    }
  }

  private async readJson<SchemaType extends Schema.ConstraintCodec<unknown>>(
    path: string,
    schema: SchemaType,
  ): Promise<SchemaType['Type'] | undefined> {
    try {
      const contents = await readFile(path, 'utf8')
      return Schema.decodeUnknownSync(schema)(JSON.parse(contents))
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined
      }
      throw error
    }
  }

  private async writeJson<SchemaType extends Schema.ConstraintCodec<unknown>>(
    path: string,
    schema: SchemaType,
    value: SchemaType['Type'],
  ): Promise<void> {
    const directory = join(path, '..')
    await mkdir(directory, { recursive: true })
    const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
    const encoded = Schema.encodeUnknownSync(schema)(value)
    await writeFile(temporaryPath, `${JSON.stringify(encoded, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  }

  private assertAnswer(round: RoundType, answer: Answer): void {
    if (answer.roundId !== round.roundId) {
      throw new InvalidAnswerError('The answer belongs to a different round.')
    }
    const expectedIds = new Set(round.questions.map(question => question.id))
    const answerIds = Object.keys(answer.answers)
    if (
      answerIds.length !== expectedIds.size ||
      answerIds.some(questionId => !expectedIds.has(questionId))
    ) {
      throw new InvalidAnswerError('Every question must be answered exactly once.')
    }

    for (const question of round.questions) {
      const questionAnswer = answer.answers[question.id]
      if (questionAnswer === undefined) {
        throw new InvalidAnswerError(`Missing answer for ${question.id}.`)
      }
      const hasOther =
        questionAnswer.other !== undefined &&
        questionAnswer.other !== null &&
        questionAnswer.other.trim() !== ''
      if (hasOther && question.allowOther === false) {
        throw new InvalidAnswerError(`Other is not allowed for ${question.id}.`)
      }
      if (
        questionAnswer.notes !== undefined &&
        questionAnswer.notes !== null &&
        question.allowNotes === false
      ) {
        throw new InvalidAnswerError(`Notes are not allowed for ${question.id}.`)
      }
      if (
        questionAnswer.selected.some(
          label => !question.options.some(option => option.label === label),
        )
      ) {
        throw new InvalidAnswerError(`Unknown option for ${question.id}.`)
      }
      if (new Set(questionAnswer.selected).size !== questionAnswer.selected.length) {
        throw new InvalidAnswerError(`Duplicate option for ${question.id}.`)
      }
      if (question.multiSelect !== true && questionAnswer.selected.length > 1) {
        throw new InvalidAnswerError(`Only one option is allowed for ${question.id}.`)
      }
      if (questionAnswer.selected.length === 0 && !hasOther) {
        throw new InvalidAnswerError(`An answer is required for ${question.id}.`)
      }
    }
  }
}

export class MissingRoundError extends Error {}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
