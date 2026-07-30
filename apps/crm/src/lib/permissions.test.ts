import { describe, expect, it } from 'vitest';
import { can, canList } from '@skarion/permissions';

const caller = { userId: 'member-1', isSuperadmin: false };
const teammateRecord = { ownerId: 'member-2' };

describe('shared CRM permissions', () => {
  it('lets members list, view, and edit teammate records', () => {
    expect(canList(false, 'member', caller, teammateRecord.ownerId)).toBe(true);
    expect(can(false, 'member', 'view', teammateRecord, caller)).toBe(true);
    expect(can(false, 'member', 'edit', teammateRecord, caller)).toBe(true);
  });

  it('keeps destructive and ownership actions restricted for members', () => {
    expect(can(false, 'member', 'delete', teammateRecord, caller)).toBe(false);
    expect(can(false, 'member', 'reassign', teammateRecord, caller)).toBe(false);
  });
});
