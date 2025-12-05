import React, { useState } from 'react';
import Highlight, { defaultProps } from 'prism-react-renderer';
import theme from 'prism-react-renderer/themes/vsDark';

export default function CodeBlock({ code = '', language = 'javascript', maxCollapsedLength = 800 }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // ignore
    }
  };

  const shouldCollapse = code.length > maxCollapsedLength;
  const displayCode = shouldCollapse && !expanded ? code.slice(0, maxCollapsedLength) + '\n\n// ... (truncated) ...' : code;

  return (
    <div className="relative my-4 mb-4">
      <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
        <button
          aria-label="Copy code"
          title="Copy code"
          onClick={handleCopy}
          className="text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded font-semibold hover:bg-blue-700 shadow"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {shouldCollapse && (
          <button
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
            className="text-xs bg-blue-500 text-white px-2.5 py-1.5 rounded font-semibold hover:bg-blue-600 shadow"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>

      <Highlight {...defaultProps} theme={theme} code={displayCode} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`${className} p-4 overflow-x-auto rounded-2xl border-2 border-gray-700 bg-slate-900`} style={{ ...style, paddingTop: '2.75rem' }}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line, key: i }) || {};
              const { key: _lineKey, ...restLineProps } = lineProps;
              return (
                <div key={i} {...restLineProps}>
                  {line.map((token, key) => {
                    const tokenProps = getTokenProps({ token, key }) || {};
                    const { key: _tokenKey, ...restTokenProps } = tokenProps;
                    return <span key={key} {...restTokenProps} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
