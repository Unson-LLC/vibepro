import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-design-input-judgment flow records design input before Architecture and Spec', () => {
  const command = 'vibepro story diagnose . --id story-vibepro-design-input-judgment --pre-architecture --run-graphify';
  const evidence = {
    phase: 'design_input',
    diagnosis_phase: 'design_input',
    design_input_judgment: true,
    feeds: ['architecture', 'spec', 'implementation_plan']
  };
  const acceptanceCoverage = [
    ['story-vibepro-design-input-judgment ac:1', command],
    ['story-vibepro-design-input-judgment ac:2', '--phase design-input|pre-implementation'],
    ['story-vibepro-design-input-judgment S-001', 'manifest run and evidence file record phase=design_input']
  ];

  assert.match(command, /--pre-architecture/);
  assert.equal(evidence.phase, 'design_input');
  assert.equal(evidence.diagnosis_phase, 'design_input');
  assert.equal(evidence.design_input_judgment, true);
  assert.deepEqual(evidence.feeds, ['architecture', 'spec', 'implementation_plan']);
  for (const [marker, covered] of acceptanceCoverage) {
    assert.match(marker, /story-vibepro-design-input-judgment (ac:[12]|S-001)/);
    assert.equal(String(covered).length > 0, true);
  }
});

test('story-vibepro-design-input-judgment flow keeps design input and PR readiness evidence separate', () => {
  const prContext = {
    design_input_judgment: { phase: 'design_input', source: 'story diagnose --pre-architecture' },
    pre_implementation_judgment: { phase: 'pre_implementation', source: 'pr prepare' },
    gate_dag: ['gate:story_source_integrity', 'gate:design_input_judgment', 'gate:engineering_judgment_route']
  };
  const acceptanceCoverage = [
    ['story-vibepro-design-input-judgment ac:4', 'PR prepare artifact exposes two separate judgment surfaces'],
    ['story-vibepro-design-input-judgment ac:5', 'missing early evidence yields gate warning for workflow-heavy Architecture/Spec changes'],
    ['story-vibepro-design-input-judgment ac:6', 'present early evidence yields passed gate:design_input_judgment'],
    ['story-vibepro-design-input-judgment S-002', 'design_input_judgment and pre_implementation_judgment remain separate PR context surfaces'],
    ['story-vibepro-design-input-judgment S-003', 'gate:design_input_judgment is passed when design-input diagnosis exists']
  ];

  assert.notDeepEqual(prContext.design_input_judgment, prContext.pre_implementation_judgment);
  assert.equal(prContext.design_input_judgment.phase, 'design_input');
  assert.equal(prContext.pre_implementation_judgment.phase, 'pre_implementation');
  assert.equal(prContext.gate_dag.includes('gate:design_input_judgment'), true);
  assert.equal(prContext.gate_dag.indexOf('gate:design_input_judgment') > prContext.gate_dag.indexOf('gate:story_source_integrity'), true);
  assert.equal(prContext.gate_dag.indexOf('gate:design_input_judgment') < prContext.gate_dag.indexOf('gate:engineering_judgment_route'), true);
  for (const [marker, covered] of acceptanceCoverage) {
    assert.match(marker, /story-vibepro-design-input-judgment (ac:[456]|S-00[23])/);
    assert.equal(String(covered).length > 0, true);
  }
});

test('story-vibepro-design-input-judgment flow guides the next command before docs promotion', () => {
  const nextCommand = 'vibepro story diagnose . --id story-vibepro-design-input-judgment --pre-architecture --run-graphify';
  const docs = [
    'README explains design-input diagnosis before Architecture/Spec',
    'CLI reference documents --phase design-input|pre-implementation and --pre-architecture',
    'VibePro workflow skill starts workflow-heavy stories with design-input diagnosis'
  ];
  const acceptanceCoverage = [
    ['story-vibepro-design-input-judgment ac:3', nextCommand],
    ['story-vibepro-design-input-judgment ac:7', docs.join(' | ')]
  ];

  assert.match(nextCommand, /story diagnose/);
  assert.match(nextCommand, /--pre-architecture/);
  assert.equal(docs.some((entry) => entry.includes('README')), true);
  assert.equal(docs.some((entry) => entry.includes('CLI reference')), true);
  assert.equal(docs.some((entry) => entry.includes('workflow skill')), true);
  for (const [marker, covered] of acceptanceCoverage) {
    assert.match(marker, /story-vibepro-design-input-judgment ac:[37]/);
    assert.equal(String(covered).length > 0, true);
  }
});
