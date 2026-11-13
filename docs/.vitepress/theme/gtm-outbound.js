const OUTBOUND_EVENT = 'outbound_click';
const GTM_CONTAINER_ID = typeof __GTM_CONTAINER_ID__ === 'string' ? __GTM_CONTAINER_ID__ : '';
let installed = false;

export function installOutboundClickTracking() {
  if (!GTM_CONTAINER_ID) return;
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', trackOutboundClick, true);
}

function trackOutboundClick(event) {
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;

  let url;
  try {
    url = new URL(anchor.getAttribute('href'), window.location.href);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.hostname === window.location.hostname) return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: OUTBOUND_EVENT,
    outbound_url: url.href,
    outbound_domain: url.hostname,
    link_text: (anchor.textContent || '').trim().slice(0, 100),
    link_target: anchor.getAttribute('target') || ''
  });
}
