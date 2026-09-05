'use client';
import { useEffect, useRef, useState } from 'react';
import { useBlob } from './data';
import { href, publicBase } from '@/lib/routes';
import 'katex/dist/katex.min.css';
let diagramSequence = 0;
export function Markdown({
  hash,
  snapshot,
  anchor,
}: {
  hash?: string;
  snapshot: string;
  anchor?: string;
}) {
  const { value, error } = useBlob(hash);
  const root = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const element = root.current;
    if (!element || !value) return;
    let disposed = false;
    const handleUnavailableLink = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('a[data-unavailable]')
      ) {
        event.preventDefault();
        setNotice(
          'This link points to material not published in the selected snapshot. Open the source repository to follow it.',
        );
      }
    };
    element.addEventListener('click', handleUnavailableLink);
    element
      .querySelectorAll<HTMLAnchorElement>('a[data-document-path]')
      .forEach((link) => {
        link.href = href({
          view: 'document',
          snapshot,
          path: link.dataset.documentPath,
          anchor: link.dataset.documentAnchor,
        });
      });
    element
      .querySelectorAll<HTMLImageElement>('img[src^="content/"]')
      .forEach((img) => {
        img.src = publicBase() + img.getAttribute('src');
        img.loading = 'lazy';
      });
    element
      .querySelectorAll<HTMLAnchorElement>('a[href^="http"]')
      .forEach((a) => {
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
      });
    element.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      if (pre.querySelector('.language-mermaid,.copy-code')) return;
      const button = document.createElement('button');
      button.className = 'copy-code';
      button.type = 'button';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', 'Copy code block');
      button.onclick = () =>
        navigator.clipboard
          .writeText(pre.querySelector('code')?.textContent ?? '')
          .then(() => {
            button.textContent = 'Copied';
          })
          .catch(() =>
            setNotice(
              'Clipboard access is unavailable. Select and copy the code instead.',
            ),
          );
      pre.append(button);
    });
    const diagrams = element.querySelectorAll<HTMLElement>(
      'code.language-mermaid',
    );
    if (diagrams.length)
      import('mermaid')
        .then(async ({ default: mermaid }) => {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'dark',
            maxTextSize: 100000,
            suppressErrorRendering: true,
          });
          for (const code of diagrams) {
            if (disposed) break;
            try {
              const { svg } = await mermaid.render(
                `neo-diagram-${++diagramSequence}`,
                code.textContent ?? '',
              );
              if (!disposed) {
                const figure = document.createElement('figure');
                figure.className = 'mermaid-figure';
                figure.innerHTML = svg;
                code.parentElement?.replaceWith(figure);
              }
            } catch {
              code.parentElement?.setAttribute(
                'aria-label',
                'Diagram source; preview unavailable',
              );
            }
          }
        })
        .catch(() =>
          setNotice('Diagrams could not load. Their source remains available.'),
        );
    return () => {
      disposed = true;
      element.removeEventListener('click', handleUnavailableLink);
    };
  }, [value, snapshot]);
  useEffect(() => {
    const element = root.current;
    let disposed = false;
    if (anchor && element)
      setTimeout(() => {
        if (!disposed)
          element
            .querySelector<HTMLElement>(`[id="${CSS.escape(anchor)}"]`)
            ?.scrollIntoView({ block: 'start' });
      }, 50);
    return () => {
      disposed = true;
    };
  }, [value, anchor]);
  if (error)
    return (
      <p role="alert" className="notice">
        {error}
      </p>
    );
  if (!value)
    return (
      <p role="status" className="empty-copy">
        Loading document…
      </p>
    );
  return (
    <>
      {notice && <p className="notice">{notice}</p>}
      <div
        ref={root}
        className="prose"
        dangerouslySetInnerHTML={{ __html: value.html }}
      />
    </>
  );
}
