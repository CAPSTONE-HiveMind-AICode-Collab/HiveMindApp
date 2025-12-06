// src/components/attachmentList.jsx
"use client";

export default function AttachmentList({ attachments = [] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    // IMPORTANT:
    // pointer-events-none ensures this whole block cannot "sit on top" and block
    // clicks on Ask AI / Create Task / Start Thread.
    // Then we selectively re-enable pointer events for interactive things.
    <div className="mt-2 space-y-2 pointer-events-none">
      {attachments.map((a, idx) => (
        <div
          key={idx}
          className="text-xs border border-gray-300 rounded p-2 bg-gray-50"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-gray-800 truncate">
              📄 {a.name || "file"}
            </div>

            {a.url && (
              // Re-enable pointer events so the link is clickable
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                Download
              </a>
            )}
          </div>

          <div className="text-[11px] text-gray-600 mt-1">
            {a.contentType || "unknown type"} • {Math.round((a.size || 0) / 1024)}{" "}
            KB
          </div>

          {a.text && (
            // Re-enable pointer events for selecting/copying/scrolling in preview
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap bg-white border border-gray-200 rounded p-2 text-[11px] pointer-events-auto">
              {a.text}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
