import { BigNumber } from '@ethersproject/bignumber';

const multicallerInstances: { call: jest.Mock; execute: jest.Mock }[] = [];

jest.mock('../../utils', () => ({
  Multicaller: jest.fn().mockImplementation(() => {
    const inst = {
      call: jest.fn(),
      execute: jest.fn()
    };
    multicallerInstances.push(inst);
    return inst;
  }),
  subgraphRequest: jest.fn().mockResolvedValue({ positions: [] })
}));

import { strategy } from './index';

describe('fountainhead strategy (mocked multicall)', () => {
  const user = '0x1111111111111111111111111111111111111111';
  const locker = '0x2222222222222222222222222222222222222222';
  const token = '0x3333333333333333333333333333333333333333';
  const factory = '0x4444444444444444444444444444444444444444';
  const cappedIndices = Array.from({ length: 1024 }, (_, i) => 1499 - i);

  beforeEach(() => {
    multicallerInstances.length = 0;
    jest.clearAllMocks();
    const utils = jest.requireMock('../../utils') as { Multicaller: jest.Mock };
    let n = 0;
    utils.Multicaller.mockImplementation(() => {
      const inst = {
        call: jest.fn(),
        execute: jest.fn()
      };
      multicallerInstances.push(inst);
      const i = n++;

      if (i === 0) {
        inst.execute.mockResolvedValue({
          [user]: { isCreated: true, lockerAddress: locker }
        });
      } else if (i === 1) {
        inst.execute.mockResolvedValue({
          [`available-${locker}`]: BigNumber.from(0),
          [`staked-${locker}`]: BigNumber.from(0),
          [`fontaineCount-${locker}`]: 1500
        });
      } else if (i === 2) {
        const m4Result: Record<string, string> = {};
        for (const j of cappedIndices) {
          m4Result[`${locker}-${j}`] = `0x${(100000 + j)
            .toString(16)
            .padStart(40, '0')}`;
        }
        inst.execute.mockResolvedValue(m4Result);
      } else if (i === 3) {
        const m5Result: Record<string, BigNumber> = {};
        m5Result[`unlocked-${user}`] = BigNumber.from(0);
        for (const j of cappedIndices) {
          m5Result[`fontaine-${locker}-${j}`] = BigNumber.from(0);
        }
        inst.execute.mockResolvedValue(m5Result);
      }

      return inst;
    });
  });

  it('never encodes balanceOf with a missing fontaine address (1500 fontaines, cap 1024)', async () => {
    await strategy(
      'space',
      '8453',
      {} as any,
      [user],
      {
        lockerFactoryAddress: factory,
        tokenAddress: token
      },
      'latest'
    );

    expect(multicallerInstances).toHaveLength(4);
    const mCall5 = multicallerInstances[3];

    const balanceOfCalls = mCall5.call.mock.calls.filter(
      (c: unknown[]) => c[2] === 'balanceOf'
    );
    const fontaineBalanceCalls = balanceOfCalls.filter((c: unknown[]) =>
      String(c[0]).startsWith('fontaine-')
    );

    expect(fontaineBalanceCalls).toHaveLength(1024);
    for (const call of fontaineBalanceCalls) {
      const args = call[3] as string[];
      expect(args[0]).toBeTruthy();
      expect(typeof args[0]).toBe('string');
      expect(args[0]).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  it('warns and skips missing fontaine addresses instead of calling balanceOf(undefined)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    multicallerInstances.length = 0;
    jest.clearAllMocks();
    const utils = jest.requireMock('../../utils') as { Multicaller: jest.Mock };
    let n = 0;
    utils.Multicaller.mockImplementation(() => {
      const inst = {
        call: jest.fn(),
        execute: jest.fn()
      };
      multicallerInstances.push(inst);
      const i = n++;

      if (i === 0) {
        inst.execute.mockResolvedValue({
          [user]: { isCreated: true, lockerAddress: locker }
        });
      } else if (i === 1) {
        inst.execute.mockResolvedValue({
          [`available-${locker}`]: BigNumber.from(0),
          [`staked-${locker}`]: BigNumber.from(0),
          [`fontaineCount-${locker}`]: 1500
        });
      } else if (i === 2) {
        const m4Result: Record<string, string> = {};
        for (const j of cappedIndices.slice(1)) {
          m4Result[`${locker}-${j}`] = `0x${(100000 + j)
            .toString(16)
            .padStart(40, '0')}`;
        }
        inst.execute.mockResolvedValue(m4Result);
      } else if (i === 3) {
        const m5Result: Record<string, BigNumber> = {};
        m5Result[`unlocked-${user}`] = BigNumber.from(0);
        for (const j of cappedIndices.slice(1)) {
          m5Result[`fontaine-${locker}-${j}`] = BigNumber.from(0);
        }
        inst.execute.mockResolvedValue(m5Result);
      }

      return inst;
    });

    await strategy(
      'space',
      '8453',
      {} as any,
      [user],
      {
        lockerFactoryAddress: factory,
        tokenAddress: token
      },
      'latest'
    );

    const mCall5 = multicallerInstances[3];
    const fontaineBalanceCalls = mCall5.call.mock.calls.filter((c: unknown[]) =>
      String(c[0]).startsWith('fontaine-')
    );

    expect(fontaineBalanceCalls).toHaveLength(1023);
    expect(fontaineBalanceCalls.some((c: unknown[]) => !c[3][0])).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'missing fontaine address for locker 0x2222222222222222222222222222222222222222 at index 1499'
      )
    );

    warnSpy.mockRestore();
  });
});
