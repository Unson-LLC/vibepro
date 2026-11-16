<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps({ source: { type: String, required: true } });
const { isDark } = useData();
const svg = ref('');
const error = ref(false);
let revision = 0;
let stopWatching;

async function renderDiagram() {
  const current = ++revision;
  error.value = false;
  try {
    // Mermaid needs the browser DOM; never load it during static rendering.
    const { default: mermaid } = await import('mermaid');
    if (current !== revision) return;
    await document.fonts.ready;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
      flowchart: { htmlLabels: false }
    });
    const id = `mermaid-${crypto.randomUUID()}`;
    const result = await mermaid.render(id, props.source);
    if (current === revision) svg.value = result.svg;
  } catch {
    if (current === revision) {
      svg.value = '';
      error.value = true;
    }
  }
}

onMounted(() => {
  stopWatching = watch([() => props.source, isDark], renderDiagram, { immediate: true });
});
onBeforeUnmount(() => {
  revision += 1;
  stopWatching?.();
});
</script>

<template>
  <div class="mermaid-diagram" :data-mermaid-state="error ? 'error' : svg ? 'rendered' : 'pending'">
    <div v-if="svg" class="mermaid-svg" v-html="svg" />
    <template v-else>
      <p v-if="error" role="alert">図を描画できませんでした。 / Unable to render diagram.</p>
      <pre class="mermaid-source">{{ source }}</pre>
    </template>
  </div>
</template>

<style scoped>
.mermaid-diagram { margin: 24px 0; overflow-x: auto; }
.mermaid-svg { display: flex; justify-content: center; }
.mermaid-svg :deep(svg) { max-width: 100%; height: auto; }
.mermaid-source { padding: 16px; white-space: pre; }
</style>
