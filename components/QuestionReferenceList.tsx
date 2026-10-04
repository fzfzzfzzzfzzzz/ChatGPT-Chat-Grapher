import { useState } from "react";
import { Crosshair, FileText, Image as ImageIcon, Quote } from "lucide-react";
import { countQuestionReferences, isAllowedThumbnailDataUrl } from "../shared/questionReferences";
import type { QuestionReference } from "../types/domain";

type Props = {
  references: readonly QuestionReference[];
  onLocate?: (reference: QuestionReference) => Promise<void>;
};

type BadgesProps = {
  references: readonly QuestionReference[] | undefined;
  onOpen: () => void;
};

export function QuestionReferenceBadges({ references, onOpen }: BadgesProps) {
  const counts = countQuestionReferences(references);
  if (!counts.total) return null;
  return (
    <button
      className="graph-reference-badges"
      type="button"
      title="查看引用内容"
      aria-label={`查看引用内容，共 ${counts.total} 条`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {counts.files ? <span aria-label={`${counts.files} 个附件`}>📎 {counts.files}</span> : null}
      {counts.images ? <span aria-label={`${counts.images} 张图片`}>🖼 {counts.images}</span> : null}
      {counts.assistantQuotes ? <span aria-label={`${counts.assistantQuotes} 个回答引用`}>💬 {counts.assistantQuotes}</span> : null}
    </button>
  );
}

export function QuestionReferenceList({ references, onLocate }: Props) {
  const [locatingId, setLocatingId] = useState<string>();
  if (!references.length) return null;

  async function locate(reference: QuestionReference) {
    if (!onLocate || !reference.sourceLocator) return;
    setLocatingId(reference.id);
    try {
      await onLocate(reference);
    } finally {
      setLocatingId(undefined);
    }
  }

  return (
    <section className="question-references" aria-label={`引用内容，共 ${references.length} 条`}>
      <div className="question-references__heading">
        <span>引用内容</span>
        <small>{references.length}</small>
      </div>
      <div className="question-references__list">
        {references.map((reference) => (
          <article className={`question-reference question-reference--${reference.type}`} key={reference.id}>
            <div className="question-reference__icon" aria-hidden="true">
              {reference.type === "file" ? <FileText size={15} /> :
                reference.type === "image" ? <ImageIcon size={15} /> : <Quote size={15} />}
            </div>
            <div className="question-reference__content">
              <strong>{referenceTitle(reference)}</strong>
              {reference.type === "file" ? (
                reference.mimeType || reference.size !== undefined
                  ? <small>{[reference.mimeType, formatFileSize(reference.size)].filter(Boolean).join(" · ")}</small>
                  : null
              ) : reference.type === "image" ? (
                <>
                  {reference.alt && reference.alt !== reference.name ? <small>{reference.alt}</small> : null}
                  {reference.thumbnailDataUrl && isAllowedThumbnailDataUrl(reference.thumbnailDataUrl) ? (
                    <a
                      className="question-reference__preview"
                      href={reference.thumbnailDataUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="打开图片预览"
                    >
                      <img src={reference.thumbnailDataUrl} alt={reference.alt || reference.name || "引用图片"} />
                    </a>
                  ) : <small>缩略图不可用</small>}
                </>
              ) : (
                <blockquote>{reference.excerpt}</blockquote>
              )}
            </div>
            {onLocate && reference.sourceLocator ? (
              <button
                className="question-reference__locate"
                type="button"
                disabled={locatingId === reference.id}
                onClick={() => void locate(reference)}
                aria-label={`定位引用原文：${referenceTitle(reference)}`}
                title="定位引用原文"
              >
                <Crosshair size={14} />
                <span>{locatingId === reference.id ? "定位中…" : "定位"}</span>
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function referenceTitle(reference: QuestionReference): string {
  if (reference.type === "file") return reference.name;
  if (reference.type === "image") return reference.name || reference.alt || "引用图片";
  return "引用的 GPT 回答";
}

function formatFileSize(size: number | undefined): string {
  if (size === undefined) return "";
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}
