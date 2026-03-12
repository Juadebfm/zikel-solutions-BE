import { describe, expect, it } from 'vitest';
import { AskAiBodySchema } from '../src/modules/ai/ai.schema.js';

describe('ai schema contracts', () => {
  it('accepts minimal ask-ai payload', () => {
    const result = AskAiBodySchema.safeParse({
      query: 'What should I focus on today?',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe('summary');
    }
  });

  it('rejects too-short queries', () => {
    const result = AskAiBodySchema.safeParse({
      query: 'hi',
    });

    expect(result.success).toBe(false);
  });

  it('accepts contextual summary data', () => {
    const result = AskAiBodySchema.safeParse({
      query: 'Summarize pending approvals',
      context: {
        stats: {
          pendingApproval: 4,
          overdue: 2,
        },
        todos: [{ title: 'Complete MAR log', priority: 'high' }],
      },
    });

    expect(result.success).toBe(true);
  });
});
