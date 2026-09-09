import type { FuriganaSegment } from '@japanesesite/shared';

export interface FuriganaProps {
  segments: readonly FuriganaSegment[];
  className?: string;
}

/**
 * The single component that renders furigana segments. Nothing else in
 * the app should build <ruby> markup directly.
 */
export function Furigana({ segments, className }: FuriganaProps) {
  return (
    <span lang="ja" className={className}>
      {segments.map((segment, index) =>
        segment.reading ? (
          <ruby key={`${index}-${segment.base}`}>
            {segment.base}
            <rt>{segment.reading}</rt>
          </ruby>
        ) : (
          <span key={`${index}-${segment.base}`}>{segment.base}</span>
        ),
      )}
    </span>
  );
}
