import { describe, it, expect, vi } from 'vitest';
import { queryRegistryValue } from './registry-value.mjs';

describe('registry policy observation', () => {
  const key = 'HKLM\\SOFTWARE\\Policies\\Example';

  it.each([['absent\r\n', false], ['present\r\n', true]])('decodes a successful %s observation', (output, expected) => {
    expect(queryRegistryValue(key, '*', () => output)).toBe(expected);
  });

  it.each([1, 2, null])('propagates query execution errors with status %s', (status) => {
    const error = Object.assign(new Error('Access is denied or query failed'), { status });
    expect(() => queryRegistryValue(key, '*', () => { throw error; })).toThrow(error);
  });

  it.each(['', 'False', 'warning\nabsent'])('rejects ambiguous output %s', (output) => {
    expect(() => queryRegistryValue(key, '*', () => output)).toThrow(/invalid result/);
  });

  it('passes key/value as data and bounds the query process', () => {
    const execute = vi.fn(() => 'absent');
    const value = "*'; throw 'must remain data";
    queryRegistryValue(key, value, execute);
    const [program, args, options] = execute.mock.calls[0];
    expect(program).toBe('powershell.exe');
    expect(args.at(-1)).not.toContain(value);
    expect(options.env.SYSMON_REGISTRY_SUBKEY).toBe('SOFTWARE\\Policies\\Example');
    expect(options.env.SYSMON_REGISTRY_VALUE).toBe(value);
    expect(options.timeout).toBe(10_000);
  });
});
