import DefaultTheme from 'vitepress/theme';
import MermaidDiagram from './MermaidDiagram.vue';
import { installOutboundClickTracking } from './gtm-outbound.js';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram);
    installOutboundClickTracking();
  }
};
