import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HANDOFF_ISSUER_ENV,
  HANDOFF_ISSUER_FILENAME,
  OUTCOME_CASE_SERVICE_ENV,
  OUTCOME_CASE_SERVICE_FILENAME,
  PRODUCER_MODULE_ENV,
  PRODUCER_ROOT_ENV,
  resolveBrainbaseProducerModules,
} from './support/brainbase-producer-modules.js';

async function writeModule(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'export const marker = true;\n');
}

async function layout(builder) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-brainbase-producer-modules-'));
  const producerModulePath = path.join(root, 'producer', 'create-vibepro-managed-handoff.js');
  await writeModule(producerModulePath);
  await builder({ root, producerModulePath });
  return { root, producerModulePath };
}

function envFor(producerModulePath, extra = {}) {
  return {
    [PRODUCER_MODULE_ENV]: producerModulePath,
    ...extra,
  };
}

test('an unset producer module leaves the contract modules unresolved', async () => {
  const resolved = await resolveBrainbaseProducerModules({});
  assert.deepEqual(resolved, {
    producerModulePath: null,
    outcomeCaseServicePath: null,
    handoffIssuerPath: null,
  });
});

test('issuer and outcome-case-service in the producer directory are used', async () => {
  const { producerModulePath } = await layout(async ({ producerModulePath: producer }) => {
    const directory = path.dirname(producer);
    await writeModule(path.join(directory, OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(directory, HANDOFF_ISSUER_FILENAME));
  });

  const resolved = await resolveBrainbaseProducerModules(envFor(producerModulePath));
  assert.equal(resolved.outcomeCaseServicePath, path.join(path.dirname(producerModulePath), OUTCOME_CASE_SERVICE_FILENAME));
  assert.equal(resolved.handoffIssuerPath, path.join(path.dirname(producerModulePath), HANDOFF_ISSUER_FILENAME));
});

test('issuer and outcome-case-service in separate directories are found from the producer parents', async () => {
  const { root, producerModulePath } = await layout(async ({ root: base }) => {
    await writeModule(path.join(base, 'outcome', 'nested', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(base, 'handoff', HANDOFF_ISSUER_FILENAME));
  });

  const resolved = await resolveBrainbaseProducerModules(envFor(producerModulePath));
  assert.equal(resolved.producerModulePath, path.resolve(producerModulePath));
  assert.equal(resolved.outcomeCaseServicePath, path.join(root, 'outcome', 'nested', OUTCOME_CASE_SERVICE_FILENAME));
  assert.equal(resolved.handoffIssuerPath, path.join(root, 'handoff', HANDOFF_ISSUER_FILENAME));
});

test('a producer root finds modules in separate directories and ignores files outside that root', async () => {
  const { root, producerModulePath } = await layout(async ({ root: base }) => {
    await writeModule(path.join(base, 'inside', 'cases', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(base, 'inside', 'issuer', HANDOFF_ISSUER_FILENAME));
    await writeModule(path.join(base, 'outside', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(base, 'outside', HANDOFF_ISSUER_FILENAME));
  });

  const resolved = await resolveBrainbaseProducerModules(envFor(producerModulePath, {
    [PRODUCER_ROOT_ENV]: path.join(root, 'inside'),
  }));
  assert.equal(resolved.outcomeCaseServicePath, path.join(root, 'inside', 'cases', OUTCOME_CASE_SERVICE_FILENAME));
  assert.equal(resolved.handoffIssuerPath, path.join(root, 'inside', 'issuer', HANDOFF_ISSUER_FILENAME));
});

test('explicit issuer and outcome-case-service paths win over discovered files', async () => {
  const { root, producerModulePath } = await layout(async ({ root: base, producerModulePath: producer }) => {
    const directory = path.dirname(producer);
    await writeModule(path.join(directory, OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(directory, HANDOFF_ISSUER_FILENAME));
    await writeModule(path.join(base, 'chosen', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(base, 'chosen', HANDOFF_ISSUER_FILENAME));
  });

  const servicePath = path.join(root, 'chosen', OUTCOME_CASE_SERVICE_FILENAME);
  const issuerPath = path.join(root, 'chosen', HANDOFF_ISSUER_FILENAME);
  const resolved = await resolveBrainbaseProducerModules(envFor(producerModulePath, {
    [OUTCOME_CASE_SERVICE_ENV]: servicePath,
    [HANDOFF_ISSUER_ENV]: issuerPath,
  }));
  assert.equal(resolved.outcomeCaseServicePath, servicePath);
  assert.equal(resolved.handoffIssuerPath, issuerPath);
});

test('multiple matches name every path and do not choose one', async () => {
  const { root, producerModulePath } = await layout(async ({ root: base }) => {
    await writeModule(path.join(base, 'first', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(base, 'second', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(base, 'handoff', HANDOFF_ISSUER_FILENAME));
  });

  await assert.rejects(
    resolveBrainbaseProducerModules(envFor(producerModulePath)),
    (error) => {
      assert.equal(error.code, 'BRAINBASE_PRODUCER_MODULE_AMBIGUOUS');
      assert.match(error.message, new RegExp(OUTCOME_CASE_SERVICE_FILENAME));
      assert.match(error.message, /first/);
      assert.match(error.message, /second/);
      assert.match(error.message, new RegExp(OUTCOME_CASE_SERVICE_ENV));
      assert.equal(error.message.includes(path.join(root, 'handoff', HANDOFF_ISSUER_FILENAME)), false);
      return true;
    },
  );
});

test('search stops at server-parts and does not read a module outside it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-brainbase-producer-modules-'));
  const producerModulePath = path.join(root, 'packages', 'server-parts', 'handoff', 'create-vibepro-managed-handoff.js');
  await writeModule(producerModulePath);
  await writeModule(path.join(root, 'packages', OUTCOME_CASE_SERVICE_FILENAME));
  await writeModule(path.join(root, 'packages', 'server-parts', 'cases', OUTCOME_CASE_SERVICE_FILENAME));
  await writeModule(path.join(root, 'packages', HANDOFF_ISSUER_FILENAME));

  await assert.rejects(
    resolveBrainbaseProducerModules(envFor(producerModulePath)),
    (error) => {
      assert.equal(error.code, 'BRAINBASE_PRODUCER_MODULE_NOT_FOUND');
      assert.match(error.message, new RegExp(HANDOFF_ISSUER_FILENAME));
      return true;
    },
  );
});

test('a search that exceeds the directory limit fails instead of guessing', async () => {
  const { producerModulePath } = await layout(async ({ root }) => {
    await writeModule(path.join(root, 'deep', 'left', OUTCOME_CASE_SERVICE_FILENAME));
    await writeModule(path.join(root, 'deep', 'right', HANDOFF_ISSUER_FILENAME));
  });

  await assert.rejects(
    resolveBrainbaseProducerModules(envFor(producerModulePath), {
      limits: { maxVisitedDirectories: 1 },
    }),
    (error) => {
      assert.equal(error.code, 'BRAINBASE_PRODUCER_SEARCH_LIMIT');
      assert.match(error.message, /stopped searching/);
      return true;
    },
  );
});

test('a symlink to an issuer in another directory is accepted', async () => {
  const { root, producerModulePath } = await layout(async ({ root: base, producerModulePath: producer }) => {
    const directory = path.dirname(producer);
    await writeModule(path.join(directory, OUTCOME_CASE_SERVICE_FILENAME));
    const realIssuer = path.join(base, 'elsewhere', HANDOFF_ISSUER_FILENAME);
    await writeModule(realIssuer);
    await symlink(realIssuer, path.join(directory, HANDOFF_ISSUER_FILENAME));
  });

  const resolved = await resolveBrainbaseProducerModules(envFor(producerModulePath));
  assert.equal(resolved.handoffIssuerPath, path.join(path.dirname(producerModulePath), HANDOFF_ISSUER_FILENAME));
  assert.equal(resolved.outcomeCaseServicePath, path.join(root, 'producer', OUTCOME_CASE_SERVICE_FILENAME));
});
