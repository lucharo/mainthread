/**
 * Tests for threadStore streaming block logic.
 *
 * These tests validate:
 * 1. appendTextToLastBlock - appends to existing text or creates new block
 * 2. markBlockComplete - finds tool by ID and marks complete
 * 3. Chronological ordering of blocks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useThreadStore, shouldUpdateThreadStatus, type StreamingBlock } from './threadStore';

const THREAD_ID = 'test-thread-123';
const TOOL_ID_1 = 'toolu_abc123';
const TOOL_ID_2 = 'toolu_def456';

describe('Streaming Block Logic', () => {
  beforeEach(() => {
    // Reset store state before each test
    useThreadStore.setState({
      streamingBlocks: {},
    });
  });

  describe('appendTextToLastBlock', () => {
    it('should create a new text block when no blocks exist', () => {
      const store = useThreadStore.getState();
      store.appendTextToLastBlock(THREAD_ID, 'Hello');

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].content).toBe('Hello');
    });

    it('should append to existing text block', () => {
      const store = useThreadStore.getState();
      store.appendTextToLastBlock(THREAD_ID, 'Hello');
      store.appendTextToLastBlock(THREAD_ID, ' world');

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks).toHaveLength(1); // Still one block
      expect(blocks[0].content).toBe('Hello world');
    });

    it('should create new text block after tool block', () => {
      const store = useThreadStore.getState();

      // Add text, then tool, then more text
      store.appendTextToLastBlock(THREAD_ID, 'First text');
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });
      store.appendTextToLastBlock(THREAD_ID, 'Second text');

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].content).toBe('First text');
      expect(blocks[1].type).toBe('tool_use');
      expect(blocks[2].type).toBe('text');
      expect(blocks[2].content).toBe('Second text');
    });
  });

  describe('appendStreamingBlock', () => {
    it('should add tool_use block with timestamp', () => {
      const store = useThreadStore.getState();
      const before = Date.now();

      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Bash',
        id: TOOL_ID_1,
        isComplete: false,
      });

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('tool_use');
      expect(blocks[0].name).toBe('Bash');
      expect(blocks[0].timestamp).toBeGreaterThanOrEqual(before);
    });

    it('should add thinking block', () => {
      const store = useThreadStore.getState();

      store.appendStreamingBlock(THREAD_ID, {
        type: 'thinking',
        content: 'Let me analyze...',
        signature: 'sig_123',
      });

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('thinking');
      expect(blocks[0].content).toBe('Let me analyze...');
    });
  });

  describe('markBlockComplete', () => {
    it('should mark tool block as complete by ID', () => {
      const store = useThreadStore.getState();

      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });

      store.markBlockComplete(THREAD_ID, TOOL_ID_1);

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks[0].isComplete).toBe(true);
    });

    it('should only mark the matching tool as complete', () => {
      const store = useThreadStore.getState();

      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Bash',
        id: TOOL_ID_2,
        isComplete: false,
      });

      store.markBlockComplete(THREAD_ID, TOOL_ID_1);

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks[0].isComplete).toBe(true);
      expect(blocks[1].isComplete).toBe(false);
    });

    it('should not affect text blocks', () => {
      const store = useThreadStore.getState();

      store.appendTextToLastBlock(THREAD_ID, 'Some text');
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });

      store.markBlockComplete(THREAD_ID, TOOL_ID_1);

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].isComplete).toBeUndefined();
      expect(blocks[1].isComplete).toBe(true);
    });
  });

  describe('clearStreamingBlocks', () => {
    it('should clear all blocks for a thread', () => {
      const store = useThreadStore.getState();

      store.appendTextToLastBlock(THREAD_ID, 'Text');
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });

      expect(useThreadStore.getState().streamingBlocks[THREAD_ID]).toHaveLength(2);

      store.clearStreamingBlocks(THREAD_ID);

      expect(useThreadStore.getState().streamingBlocks[THREAD_ID]).toBeUndefined();
    });
  });

  describe('Chronological Ordering', () => {
    it('should preserve order: text -> tool -> text -> tool -> text', () => {
      const store = useThreadStore.getState();

      store.appendTextToLastBlock(THREAD_ID, "I'll count the characters.");
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });
      store.markBlockComplete(THREAD_ID, TOOL_ID_1);
      store.appendTextToLastBlock(THREAD_ID, 'Now let me count:');
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Bash',
        id: TOOL_ID_2,
        isComplete: false,
      });
      store.markBlockComplete(THREAD_ID, TOOL_ID_2);
      store.appendTextToLastBlock(THREAD_ID, 'The answer is 42.');

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];
      const types = blocks.map((b) => b.type);

      expect(types).toEqual(['text', 'tool_use', 'text', 'tool_use', 'text']);
    });

    it('should have increasing timestamps', () => {
      const store = useThreadStore.getState();

      store.appendTextToLastBlock(THREAD_ID, 'First');
      store.appendStreamingBlock(THREAD_ID, {
        type: 'tool_use',
        name: 'Read',
        id: TOOL_ID_1,
        isComplete: false,
      });
      store.appendTextToLastBlock(THREAD_ID, 'Second');

      const blocks = useThreadStore.getState().streamingBlocks[THREAD_ID];

      // Timestamps should be non-decreasing (could be equal if fast)
      expect(blocks[1].timestamp).toBeGreaterThanOrEqual(blocks[0].timestamp);
      expect(blocks[2].timestamp).toBeGreaterThanOrEqual(blocks[1].timestamp);
    });
  });
});

/**
 * Tests for shouldUpdateThreadStatus helper.
 *
 * This guards against race conditions where late-arriving SSE events
 * try to overwrite a completed thread's status.
 */
describe('shouldUpdateThreadStatus', () => {
  describe('race condition guard', () => {
    it('should reject updates from done to pending', () => {
      expect(shouldUpdateThreadStatus('done', 'pending')).toBe(false);
    });

    it('should reject updates from done to active', () => {
      expect(shouldUpdateThreadStatus('done', 'active')).toBe(false);
    });

    it('should reject updates from done to new_message', () => {
      expect(shouldUpdateThreadStatus('done', 'new_message')).toBe(false);
    });

    it('should reject updates from done to needs_attention', () => {
      expect(shouldUpdateThreadStatus('done', 'needs_attention')).toBe(false);
    });

    it('should allow updates from done to done (idempotent)', () => {
      expect(shouldUpdateThreadStatus('done', 'done')).toBe(true);
    });
  });

  describe('normal status transitions', () => {
    it('should allow updates from pending to active', () => {
      expect(shouldUpdateThreadStatus('pending', 'active')).toBe(true);
    });

    it('should allow updates from pending to done', () => {
      expect(shouldUpdateThreadStatus('pending', 'done')).toBe(true);
    });

    it('should allow updates from active to new_message', () => {
      expect(shouldUpdateThreadStatus('active', 'new_message')).toBe(true);
    });

    it('should allow updates from new_message to done', () => {
      expect(shouldUpdateThreadStatus('new_message', 'done')).toBe(true);
    });

    it('should allow updates from active to needs_attention', () => {
      expect(shouldUpdateThreadStatus('active', 'needs_attention')).toBe(true);
    });

    it('should allow updates when current status is undefined', () => {
      expect(shouldUpdateThreadStatus(undefined, 'pending')).toBe(true);
      expect(shouldUpdateThreadStatus(undefined, 'done')).toBe(true);
    });
  });
});
