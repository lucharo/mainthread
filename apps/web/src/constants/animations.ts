/**
 * Animation timing constants for consistent UI behavior.
 *
 * These constants ensure that related animations and delays stay in sync.
 * When changing animation durations, update these constants and all dependent
 * code will automatically use the new values.
 */

/**
 * Duration for collapsible block animations (tool blocks, thinking blocks, etc.)
 * Used when automatically collapsing blocks after completion.
 */
export const COLLAPSE_ANIMATION_DURATION_MS = 500;

/**
 * Delay before clearing streaming blocks after message completion.
 * Must be greater than COLLAPSE_ANIMATION_DURATION_MS to allow animations to finish.
 */
export const STREAMING_BLOCK_CLEAR_DELAY_MS = COLLAPSE_ANIMATION_DURATION_MS + 100;

/**
 * FIFO: How many recent tool blocks stay expanded.
 * When a new tool_use block arrives and the queue exceeds this limit,
 * the oldest blocks are collapsed to make room.
 */
export const RECENT_TOOLS_EXPANDED = 2;
