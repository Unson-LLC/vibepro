import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { mermaidPlugin } from '../scripts/manual-mermaid.mjs';

test('public manual renders only exact mermaid fences as MermaidDiagram components', async (t) => {
  const markdown = [
    '```mermaid',
    'flowchart TD',
    '  A[日本語] --> B["quoted"]',
    '  B --> C[`${danger}` & <tag>]',
    '```',
    '',
    '```mermaid javascript',
    'this remains an ordinary fence',
    '```',
    '',
    '```javascript',
    'const value = "<div>";',
    '```'
  ].join('\n');

  t.after(() => disposeMdItInstance());
  const md = await createMarkdownRenderer(process.cwd(), {
    highlight: () => '',
    config: mermaidPlugin
  });
  const rendered = md.render(markdown);

  assert.equal((rendered.match(/<MermaidDiagram\b/gu) ?? []).length, 1);
  assert.match(rendered, /<MermaidDiagram source="flowchart TD[\s\S]*日本語[\s\S]*&quot;quoted&quot;[\s\S]*`\$\{danger\}` &amp; &lt;tag&gt;\]\n" \/>/u);
  assert.match(rendered, /class="language-mermaid vp-adaptive-theme"/);
  assert.match(rendered, /this remains an ordinary fence/);
  assert.doesNotMatch(rendered, /MermaidDiagram source="[^"]*ordinary fence/u);
  assert.match(rendered, /language-javascript/);
  assert.match(rendered, /const value = &quot;&lt;div&gt;&quot;;/);
});
