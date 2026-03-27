import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CognitiveVaultBoard } from '../../src/adapters/cognitive-vault.js'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('CognitiveVaultBoard', () => {
  let board: CognitiveVaultBoard

  beforeEach(() => {
    vi.clearAllMocks()
    board = new CognitiveVaultBoard({
      apiUrl: 'https://cv.test',
      apiKey: 'cvk_test',
      vaultId: 'vault-123',
      sessionId: '2025-06-15-test',
    })
  })

  describe('post', () => {
    it('persists messages to CV API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'entry-1' }),
      })

      const msg = board.post('agent-a', '*', 'Found a bug', {
        type: 'finding',
        priority: 'urgent',
        channel: 'security',
      })

      expect(msg.from).toBe('agent-a')
      expect(msg.to).toBe('*')
      expect(msg.content).toBe('Found a bug')
      expect(msg.type).toBe('finding')

      // Wait for background persist
      await board.flush()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cv.test/api/v1/vaults/vault-123/entries',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer cvk_test',
          }),
        }),
      )

      // Check the body has correct tags
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.tags).toContain('agent:agent-a')
      expect(callBody.tags).toContain('agent:to:*')
      expect(callBody.tags).toContain('msg:finding')
      expect(callBody.tags).toContain('msg:priority:urgent')
      expect(callBody.tags).toContain('channel:security')
      expect(callBody.tags).toContain('session:2025-06-15-test')
      expect(callBody.entryType).toBe('SESSION_UPDATE')
      expect(callBody.sourceAgent).toBe('agent-a')
    })

    it('includes thread tag for replies', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'entry-2' }),
      })

      board.post('agent-b', 'agent-a', 'Fixed it', {
        type: 'answer',
        data: { replyTo: 'entry-1' },
      })

      await board.flush()

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.tags).toContain('thread:entry-1')
      expect(callBody.tags).toContain('agent:to:agent-a')
    })

    it('does not persist when persist=false', async () => {
      const silentBoard = new CognitiveVaultBoard({
        apiUrl: 'https://cv.test',
        apiKey: 'cvk_test',
        vaultId: 'vault-123',
        persist: false,
      })

      silentBoard.post('agent-a', '*', 'Not persisted', { type: 'status' })
      await silentBoard.flush()

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('hydrate', () => {
    it('loads messages from CV and populates the board', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: 'e1',
                title: 'finding: old bug',
                content: 'Previously found bug in auth',
                tags: ['agent:old-agent', 'agent:to:*', 'msg:finding', 'msg:priority:high', 'session:2025-06-15-test'],
                createdAt: '2025-06-15T10:00:00Z',
              },
              {
                id: 'e2',
                title: 'Some non-message entry',
                content: 'Not an agent message',
                tags: ['type:reference', 'status:active'],
                createdAt: '2025-06-15T09:00:00Z',
              },
            ],
          }),
      })

      const count = await board.hydrate()

      expect(count).toBe(1) // Only the msg: entry
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/vaults/vault-123/entries'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer cvk_test' }),
        }),
      )

      // The hydrated message should be readable
      const messages = board.read('new-agent')
      expect(messages.length).toBeGreaterThanOrEqual(1)
      expect(messages.some((m) => m.content === 'Previously found bug in auth')).toBe(true)
    })

    it('returns 0 when API fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

      const count = await board.hydrate()
      expect(count).toBe(0)
    })
  })

  describe('sessionId', () => {
    it('uses provided session ID', () => {
      expect(board.sessionId).toBe('2025-06-15-test')
    })

    it('auto-generates when not provided', () => {
      const autoBoard = new CognitiveVaultBoard({
        apiUrl: 'https://cv.test',
        apiKey: 'cvk_test',
        vaultId: 'vault-123',
      })
      expect(autoBoard.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/)
    })
  })
})
