import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { Logger, initLogger, reconfigureLogger, logger as singletonLogger } from '../../src/utils/logger'
import type { LoggingConfig } from '../../src/types'

function createTestConfig(overrides?: Partial<LoggingConfig>): LoggingConfig {
  return {
    level: 'debug',
    output: 'file',
    path: 'logs',
    maxFiles: 7,
    categories: 'all',
    format: 'text',
    ...overrides,
  }
}

async function waitForFileWrite(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 150))
}

async function readLatestLogFile(logDir: string): Promise<string> {
  const files = await fs.readdir(logDir)
  const logFiles = files.filter(f => f.startsWith('openflow-') && f.endsWith('.log'))
  if (logFiles.length === 0) return ''
  const latest = logFiles.sort().reverse()[0]
  return fs.readFile(path.join(logDir, latest), 'utf-8')
}

describe('Logger', () => {
  let tempDir: string
  let logDir: string
  let logger: Logger

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `openflow-logger-test-${Date.now()}`)
    logDir = path.join(tempDir, 'logs')
    await fs.mkdir(tempDir, { recursive: true })
    logger = new Logger()
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  describe('level filtering', () => {
    test('debug level logs all levels', async () => {
      logger.init(createTestConfig({ level: 'debug' }), tempDir)
      logger.debug('default', 'debug msg')
      logger.info('default', 'info msg')
      logger.warn('default', 'warn msg')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('debug msg')
      expect(content).toContain('info msg')
      expect(content).toContain('warn msg')
    })

    test('info level filters out debug', async () => {
      logger.init(createTestConfig({ level: 'info' }), tempDir)
      logger.debug('default', 'debug msg')
      logger.info('default', 'info msg')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).not.toContain('debug msg')
      expect(content).toContain('info msg')
    })

    test('error level only logs error', async () => {
      logger.init(createTestConfig({ level: 'error' }), tempDir)
      logger.info('default', 'info msg')
      logger.warn('default', 'warn msg')
      logger.error('default', 'error msg')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).not.toContain('info msg')
      expect(content).not.toContain('warn msg')
      expect(content).toContain('error msg')
    })
  })

  describe('category filtering', () => {
    test('logs only allowed categories', async () => {
      logger.init(createTestConfig({ categories: ['harden', 'session'] }), tempDir)
      logger.info('harden', 'harden msg')
      logger.info('session', 'session msg')
      logger.info('config', 'config msg')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('harden msg')
      expect(content).toContain('session msg')
      expect(content).not.toContain('config msg')
    })

    test("'all' categories allows everything", async () => {
      logger.init(createTestConfig({ categories: 'all' }), tempDir)
      logger.info('harden', 'harden msg')
      logger.info('config', 'config msg')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('harden msg')
      expect(content).toContain('config msg')
    })
  })

  describe('file output', () => {
    test('writes logs to file', async () => {
      logger.init(createTestConfig({ output: 'file' }), tempDir)
      logger.info('default', 'file test msg')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('file test msg')
    })

    test('writes logs to both console and file', async () => {
      const consoleLogs: string[] = []
      const originalLog = console.log
      console.log = (...args: unknown[]) => consoleLogs.push(args.join(' '))

      logger.init(createTestConfig({ output: 'both' }), tempDir)
      logger.info('default', 'both test msg')

      console.log = originalLog

      await waitForFileWrite()
      expect(consoleLogs.some(l => l.includes('both test msg'))).toBe(true)

      const content = await readLatestLogFile(logDir)
      expect(content).toContain('both test msg')
    })

    test('rotates old log files', async () => {
      await fs.mkdir(logDir, { recursive: true })

      // Create 5 old log files
      for (let i = 1; i <= 5; i++) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const fileName = `openflow-${date.toISOString().slice(0, 10)}.log`
        await fs.writeFile(path.join(logDir, fileName), 'old log', 'utf-8')
      }

      logger.init(createTestConfig({ output: 'file', maxFiles: 3 }), tempDir)
      logger.info('default', 'rotation test')

      await waitForFileWrite()
      const files = await fs.readdir(logDir)
      const logFiles = files.filter(f => f.startsWith('openflow-') && f.endsWith('.log'))
      expect(logFiles.length).toBeLessThanOrEqual(4)
      expect(logFiles.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('format', () => {
    test('text format includes timestamp and level', async () => {
      logger.init(createTestConfig({ format: 'text' }), tempDir)
      logger.info('default', 'text format test')

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('text format test')
      expect(content).toContain('[INFO]')
    })

    test('json format outputs structured data', async () => {
      logger.init(createTestConfig({ format: 'json' }), tempDir)
      logger.info('default', 'json format test', { key: 'value' })

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      const lines = content.trim().split('\n')
      const lastLine = lines[lines.length - 1]
      const parsed = JSON.parse(lastLine)
      expect(parsed.level).toBe('info')
      expect(parsed.message).toBe('json format test')
      expect(parsed.data).toEqual({ key: 'value' })
    })
  })

  describe('backward compatibility', () => {
    test('supports old signature without category', async () => {
      logger.init(createTestConfig(), tempDir)
      logger.info('old style msg', { data: 1 })

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('old style msg')
    })
  })

  describe('error logging', () => {
    test('logs error with stack trace', async () => {
      logger.init(createTestConfig(), tempDir)
      const testError = new Error('test error')
      logger.error('default', 'something failed', testError, { ctx: 'abc' })

      await waitForFileWrite()
      const content = await readLatestLogFile(logDir)
      expect(content).toContain('something failed')
      expect(content).toContain('test error')
    })
  })
})

describe('initLogger and reconfigureLogger', () => {
  test('initLogger configures the singleton logger', async () => {
    const logDir = path.join(tmpdir(), `openflow-singleton-test-${Date.now()}`)
    await fs.mkdir(logDir, { recursive: true })

    initLogger(createTestConfig({ level: 'warn', path: logDir, output: 'file' }), logDir)
    singletonLogger.info('default', 'should not appear')
    singletonLogger.warn('default', 'should appear')

    await waitForFileWrite()
    const content = await readLatestLogFile(logDir)
    expect(content).not.toContain('should not appear')
    expect(content).toContain('should appear')

    await fs.rm(logDir, { recursive: true, force: true })
  })

  test('reconfigureLogger updates settings', async () => {
    const logDir = path.join(tmpdir(), `openflow-reconfig-test-${Date.now()}`)
    await fs.mkdir(logDir, { recursive: true })

    reconfigureLogger(createTestConfig({ level: 'error', path: logDir, output: 'file' }), logDir)
    singletonLogger.warn('default', 'should not appear after reconfig')
    singletonLogger.error('default', 'should appear after reconfig')

    await waitForFileWrite()
    const content = await readLatestLogFile(logDir)
    expect(content).not.toContain('should not appear after reconfig')
    expect(content).toContain('should appear after reconfig')

    await fs.rm(logDir, { recursive: true, force: true })
  })
})
