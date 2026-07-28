import { describe, it, expect } from 'vitest';
import { isSequenceStepDue, isChannelStageTerminal } from './outreachSequence.js';

const STEPS = [
  { afterDays: 7, title: 'Step 1' },
  { afterDays: 14, title: 'Step 2' },
  { afterDays: 21, title: 'Step 3' },
];

describe('isChannelStageTerminal', () => {
  it('treats replied/in_conversation/booked_call as terminal', () => {
    expect(isChannelStageTerminal('replied')).toBe(true);
    expect(isChannelStageTerminal('in_conversation')).toBe(true);
    expect(isChannelStageTerminal('booked_call')).toBe(true);
  });

  it('treats everything else as non-terminal', () => {
    expect(isChannelStageTerminal('not_started')).toBe(false);
    expect(isChannelStageTerminal('connection_request_sent')).toBe(false);
    expect(isChannelStageTerminal('no_response')).toBe(false);
  });
});

describe('isSequenceStepDue', () => {
  const day = (n: number) => n * 24 * 60 * 60 * 1000;
  const createdAt = new Date('2026-01-01T00:00:00Z');

  it('is not due before the first step threshold', () => {
    const now = new Date(createdAt.getTime() + day(6));
    const result = isSequenceStepDue({
      followupStage: 0,
      steps: STEPS,
      lastAttemptAt: null,
      createdAt,
      now,
    });
    expect(result.due).toBe(false);
  });

  it('is due exactly at the first step threshold, falling back to createdAt when never logged', () => {
    const now = new Date(createdAt.getTime() + day(7));
    const result = isSequenceStepDue({
      followupStage: 0,
      steps: STEPS,
      lastAttemptAt: null,
      createdAt,
      now,
    });
    expect(result.due).toBe(true);
    expect(result.stepIndex).toBe(0);
    expect(result.step).toBe(STEPS[0]);
  });

  it('uses lastAttemptAt as the baseline when present, not createdAt', () => {
    const lastAttemptAt = new Date(createdAt.getTime() + day(100));
    const now = new Date(lastAttemptAt.getTime() + day(7));
    const result = isSequenceStepDue({
      followupStage: 0,
      steps: STEPS,
      lastAttemptAt,
      createdAt,
      now,
    });
    expect(result.due).toBe(true);
  });

  it('checks the step at the current followupStage, not always step 0', () => {
    const now = new Date(createdAt.getTime() + day(14));
    const result = isSequenceStepDue({
      followupStage: 1,
      steps: STEPS,
      lastAttemptAt: null,
      createdAt,
      now,
    });
    expect(result.due).toBe(true);
    expect(result.stepIndex).toBe(1);
    expect(result.step).toBe(STEPS[1]);
  });

  it('is never due once every step has already fired', () => {
    const now = new Date(createdAt.getTime() + day(1000));
    const result = isSequenceStepDue({
      followupStage: STEPS.length,
      steps: STEPS,
      lastAttemptAt: null,
      createdAt,
      now,
    });
    expect(result.due).toBe(false);
    expect(result.step).toBeUndefined();
  });
});
