import { describe, expect, it } from 'vitest';
import { displayWindowsPath } from './pathDisplay';

describe('displayWindowsPath', () => {
  it('hides local extended-length prefixes', () => {
    expect(displayWindowsPath('\\\\?\\C:\\Users\\Administrator\\笔记')).toBe('C:\\Users\\Administrator\\笔记');
  });

  it('restores standard UNC paths', () => {
    expect(displayWindowsPath('\\\\?\\UNC\\server\\share\\笔记')).toBe('\\\\server\\share\\笔记');
  });

  it('leaves ordinary paths untouched', () => {
    expect(displayWindowsPath('C:\\Notes\\Vault')).toBe('C:\\Notes\\Vault');
  });
});
