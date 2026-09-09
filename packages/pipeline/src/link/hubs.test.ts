import { describe, expect, it } from 'vitest';
import { buildHubs, capHubSize, mergeHubResults, type HubGroupInput } from './hubs.js';

describe('buildHubs', () => {
  it('drops a hub left with only one distinct member', () => {
    const groups: HubGroupInput[] = [{ key: 'x', label: 'x', members: [{ entryId: 'k:日', rank: 1 }] }];
    const { hubs, members } = buildHubs('radical', groups);
    expect(hubs).toHaveLength(0);
    expect(members).toHaveLength(0);
  });

  it('dedupes a member that appears twice in the same group before counting for the two-member threshold', () => {
    const groups: HubGroupInput[] = [
      {
        key: 'x',
        label: 'x',
        members: [
          { entryId: 'k:日', rank: 1 },
          { entryId: 'k:日', rank: 1 }, // duplicate - same entry, e.g. two identical readings
        ],
      },
    ];
    const { hubs } = buildHubs('radical', groups);
    expect(hubs).toHaveLength(0); // only one distinct member after dedup
  });

  it('keeps a hub with two or more distinct members, and memberCount matches the row count exactly', () => {
    const groups: HubGroupInput[] = [
      {
        key: '木',
        label: '木',
        members: [
          { entryId: 'k:木', rank: 3 },
          { entryId: 'k:本', rank: 2 },
          { entryId: 'k:林', rank: 4 },
        ],
      },
    ];
    const { hubs, members } = buildHubs('radical', groups);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]?.hubId).toBe('h:radical:木');
    expect(hubs[0]?.memberCount).toBe(3);
    expect(members.filter((m) => m.hubId === 'h:radical:木')).toHaveLength(3);
  });

  it('builds one hub per distinct key', () => {
    const groups: HubGroupInput[] = [
      { key: 'a', label: 'a', members: [{ entryId: 'k:1', rank: null }, { entryId: 'k:2', rank: null }] },
      { key: 'b', label: 'b', members: [{ entryId: 'k:3', rank: null }, { entryId: 'k:4', rank: null }] },
    ];
    const { hubs } = buildHubs('component', groups);
    expect(hubs.map((h) => h.hubId).sort()).toEqual(['h:component:a', 'h:component:b']);
  });
});

describe('mergeHubResults', () => {
  it('concatenates hubs and members from every result', () => {
    const a = buildHubs('radical', [
      { key: 'x', label: 'x', members: [{ entryId: 'k:1', rank: null }, { entryId: 'k:2', rank: null }] },
    ]);
    const b = buildHubs('component', [
      { key: 'y', label: 'y', members: [{ entryId: 'k:3', rank: null }, { entryId: 'k:4', rank: null }] },
    ]);
    const merged = mergeHubResults(a, b);
    expect(merged.hubs).toHaveLength(2);
    expect(merged.members).toHaveLength(4);
  });
});

describe('capHubSize', () => {
  it('drops any hub with more members than the cap, and reports how many were dropped', () => {
    const bigGroup: HubGroupInput = {
      key: 'huge',
      label: 'huge',
      members: Array.from({ length: 10 }, (_, i) => ({ entryId: `w:${i}` as const, rank: null })),
    };
    const smallGroup: HubGroupInput = {
      key: 'small',
      label: 'small',
      members: [{ entryId: 'w:100', rank: null }, { entryId: 'w:101', rank: null }],
    };
    const built = buildHubs('gloss', [bigGroup, smallGroup]);
    const { result, dropped } = capHubSize(built, 5);
    expect(dropped).toBe(1);
    expect(result.hubs).toHaveLength(1);
    expect(result.hubs[0]?.hubId).toBe('h:gloss:small');
    expect(result.members.every((m) => m.hubId === 'h:gloss:small')).toBe(true);
  });
});
