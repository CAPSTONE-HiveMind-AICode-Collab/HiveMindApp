"use client";

export default function AttachmentList({ attachments = [] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 space-y-2 pointer-events-none">
      {attachments.map((a, idx) => (
        <div
          key={idx}
          className="text-xs border border-gray-300 rounded p-2 bg-gray-50"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-gray-800 truncate">
              File {a.name || "file"}
            </div>

            {a.url && (
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
            {a.contentType || "unknown type"} | {Math.round((a.size || 0) / 1024)} KB
          </div>

          {(a.extractionMethod || a.extractionStatus || a.extractionError) && (
            <div className="mt-2 p-2 bg-white border border-gray-200 rounded pointer-events-auto">
              <div className="font-semibold text-[11px] text-gray-700">
                Extraction status
              </div>

              {a.extractionMethod && (
                <div className="mt-1 text-[11px] text-gray-700">
                  Method: {a.extractionMethod}
                </div>
              )}

              {a.extractionStatus && (
                <div className="mt-1 text-[11px] text-gray-700">
                  Status: {a.extractionStatus}
                </div>
              )}

              {a.extractionError && (
                <div className="mt-1 text-[11px] text-red-600">
                  {a.extractionError}
                </div>
              )}
            </div>
          )}

          {a.imageDescription && (
            <div className="mt-2 p-2 bg-white border border-gray-200 rounded pointer-events-auto">
              <div className="font-semibold text-[11px] text-gray-700">
                Safer image description
              </div>
              <div className="text-[11px] text-gray-800 italic mt-1">
                {a.imageDescription}
              </div>

              {a.captionRisk && (
                <div className="mt-1 text-[10px] text-gray-500">
                  Reliability: {a.captionRisk}
                </div>
              )}
            </div>
          )}

          {a.rawCaption && a.rawCaption !== a.imageDescription && (
            <details className="mt-2 pointer-events-auto">
              <summary className="cursor-pointer text-[11px] text-gray-600">
                Show raw model caption
              </summary>
              <div className="mt-1 p-2 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-gray-800">
                {a.rawCaption}
              </div>
            </details>
          )}

          {a.extractedText && (
            <div className="mt-2 p-2 bg-white border border-gray-200 rounded pointer-events-auto">
              <div className="font-semibold text-[11px] text-gray-700">
                Extracted text preview
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-gray-800">
                {a.extractedText.length > 1200
                  ? `${a.extractedText.slice(0, 1200)}\n\n[TRUNCATED]`
                  : a.extractedText}
              </pre>

              {a.ocrConfidence !== null && a.ocrConfidence !== undefined && (
                <div className="mt-1 text-[10px] text-gray-500">
                  OCR confidence: {Math.round(a.ocrConfidence)}%
                </div>
              )}
            </div>
          )}

          {!a.extractedText && a.isDocumentLike && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded pointer-events-auto text-[11px] text-amber-900">
              No readable text was extracted from this document-like upload.
            </div>
          )}

          {a.text && !a.imageDescription && !a.extractedText && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap bg-white border border-gray-200 rounded p-2 text-[11px] pointer-events-auto">
              {a.text}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
