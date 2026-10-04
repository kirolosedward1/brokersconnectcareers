import { clearPersonalCache } from '~/lib/personal-cache';

/*
  What a person picked or exported, left in the app's cache, goes when they
  do (push-bridge.tsx calls this on any change of person) — and a sign-out is
  never held up by a file.
*/

const mockDeleted: string[] = [];
const mockFolders = new Set(['file:///cache/DocumentPicker', 'file:///cache/ImageManipulator']);
let mockBroken = false;

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get name() {
      return this.uri.split('/').at(-1) ?? '';
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  }
  class MockDirectory {
    uri: string;
    constructor(...parts: string[]) {
      if (mockBroken) throw new Error('no such directory');
      this.uri = parts.join('/');
    }
    get exists() {
      return mockFolders.has(this.uri);
    }
    delete() {
      mockDeleted.push(this.uri);
    }
    list() {
      return [
        new MockFile('file:///cache/brokers-connect-data-0b5f7c3e.json'),
        new MockFile('file:///cache/fonts.json'),
        new MockDirectory('file:///cache/DocumentPicker'),
      ];
    }
  }
  return { Paths: { cache: 'file:///cache' }, File: MockFile, Directory: MockDirectory };
});

beforeEach(() => {
  mockDeleted.length = 0;
  mockBroken = false;
});

it("takes the pickers' copies and the data export, and leaves the rest of the cache", () => {
  clearPersonalCache();
  expect(mockDeleted).toEqual([
    'file:///cache/DocumentPicker',
    'file:///cache/ImageManipulator',
    'file:///cache/brokers-connect-data-0b5f7c3e.json',
  ]);
});

it('never throws', () => {
  mockBroken = true;
  expect(() => clearPersonalCache()).not.toThrow();
});
