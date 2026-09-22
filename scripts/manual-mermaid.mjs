// Keep Mermaid fences out of the ordinary syntax-highlighting path.
export function mermaidPlugin(md) {
  const originalFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    if (tokens[index].info.trim() !== 'mermaid') {
      return originalFence(tokens, index, options, env, renderer);
    }
    const source = md.utils.escapeHtml(tokens[index].content);
    return `<MermaidDiagram source="${source}" />\n`;
  };
}
