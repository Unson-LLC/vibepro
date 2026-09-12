import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { runCli } from '../src/cli.js';

test('pre-push validates target before allowing feature refs or bypass', async () => {
  const previous = process.env.VIBEPRO_EXPECTED_REPOSITORY;
  const bypass = process.env.VIBEPRO_GUARD_BYPASS;
  try {
    process.env.VIBEPRO_GUARD_BYPASS = 'test';
    for (const [expected, actual, exitCode] of [
      ['', 'https://github.com/example/private.git', 1],
      ['example/private', 'https://github.com/example/public.git', 1],
      ['example/private', '', 1],
      ['example/private', 'git@github.com:example/private.git', 0]
    ]) {
      process.env.VIBEPRO_EXPECTED_REPOSITORY = expected;
      const result = await runCli(['guard', 'check', process.cwd(), '--pre-push', 'origin', '--push-url', actual], {
        stdin: Readable.from(['refs/heads/feature/test a refs/heads/feature/test b\n'])
      });
      assert.equal(result.exitCode, exitCode);
    }
  } finally {
    if (previous === undefined) delete process.env.VIBEPRO_EXPECTED_REPOSITORY;
    else process.env.VIBEPRO_EXPECTED_REPOSITORY = previous;
    if (bypass === undefined) delete process.env.VIBEPRO_GUARD_BYPASS;
    else process.env.VIBEPRO_GUARD_BYPASS = bypass;
  }
});
