'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Maximize2, Minimize2 } from 'lucide-react';
import { assetUrl } from '@/lib/site';

/** Embed the actual demo, including its controls, styling, and keyboard shortcuts. */
export function ChartPreview() {
  const container = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  // Name the file: `next dev` does not map directory URLs in public/ to index.html.
  const demoUrl = assetUrl('/chart-demo/demo/index.html');

  useEffect(() => {
    setCanFullscreen(document.fullscreenEnabled);
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    let content: Document | null = null;
    const revealControls = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      // A bottom-rail click can leave the top of a fixed settings card above
      // the page viewport. Reveal the frame after the button has handled it.
      const target = event.target as Element | null;
      if (target?.closest('button')) frame.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const listen = () => {
      content?.removeEventListener('click', revealControls);
      content = frame.contentDocument;
      content?.addEventListener('click', revealControls);
    };
    frame.addEventListener('load', listen);
    listen();
    return () => {
      frame.removeEventListener('load', listen);
      content?.removeEventListener('click', revealControls);
    };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch {
      // Browsers that deny fullscreen can still open the full-window playground.
      setCanFullscreen(false);
    }
  }

  return <div ref={container} className="chart-preview not-prose">
    <div className="preview-header">
      <div className="preview-title"><strong>Chart playground</strong><span className="demo-label"><span /> Simulated live data</span></div>
      <div className="preview-actions">
        <a href={demoUrl} target="_blank" rel="noreferrer" className="btn btn--ghost btn--sm">Open playground <ArrowUpRight aria-hidden="true" /></a>
        {canFullscreen && <button type="button" className="btn btn--secondary btn--sm" onClick={toggleFullscreen} aria-pressed={fullscreen}>
          {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>}
      </div>
    </div>
    <iframe ref={iframe} className="chart-frame" src={demoUrl} title="Interactive Bloxwap chart playground" allowFullScreen />
    <div className="preview-footer"><span>Draw, zoom, add indicators, and make it yours.</span><span>Powered by @bloxwap/chart</span></div>
  </div>;
}
