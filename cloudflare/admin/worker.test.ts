// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { onTestsUrl } from './worker';

// The admin site's Worker fetches the change log's waiting list from the test site. It must
// fetch nothing else for whoever asks: only the list and its screenshots, by plain file name.
describe("the admin site's /on-tests/ addresses", () => {
  const tests = 'https://tests.thesciclub.com';

  it('pass on only the waiting list and its screenshots', () => {
    expect(onTestsUrl('/on-tests/on-tests.json', tests)).toBe(
      'https://tests.thesciclub.com/change-log/on-tests.json',
    );
    expect(onTestsUrl('/on-tests/shots/2026-11-25-chat-after.jpg', tests)).toBe(
      'https://tests.thesciclub.com/change-log/shots/2026-11-25-chat-after.jpg',
    );
    for (const path of [
      '/on-tests/',
      '/on-tests/version.json',
      '/on-tests/shots/../../version.json',
      '/on-tests/shots/a/b.jpg',
      '/on-tests/shots/notes.html',
      '/on-tests/shots/%2e%2e%2fversion.json',
      '/on-tests//evil.example/on-tests.json',
      '/on-tests/on-tests.json/extra',
    ]) {
      expect(onTestsUrl(path, tests), path).toBeNull();
    }
  });
});
