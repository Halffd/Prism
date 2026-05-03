import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidRendererProps {
  chart: string;
  id?: string;
}

export function MermaidRenderer({ chart, id }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const renderChart = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
        });

        const uniqueId = id || `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(uniqueId, chart);
        setSvg(svg);
        setError('');
      } catch (err) {
        setError(`Mermaid rendering error: ${err}`);
        console.error('Mermaid rendering error:', err);
      }
    };

    renderChart();
  }, [chart, id]);

  const handleExport = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mermaid-diagram-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="mermaid-error">
        <pre>{chart}</pre>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  return (
    <div className="mermaid-container">
      <div
        ref={containerRef}
        className="mermaid-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {svg && (
        <button className="export-mermaid-btn" onClick={handleExport} title="Export SVG">
          📥 Export
        </button>
      )}
    </div>
  );
}
