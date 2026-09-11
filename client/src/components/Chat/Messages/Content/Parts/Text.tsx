import { memo, useMemo, ReactElement } from 'react';
import { useRecoilValue } from 'recoil';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import Markdown from '~/components/Chat/Messages/Content/Markdown';
import { useMessageContext } from '~/Providers';
import Collapsible from './Collapsible';
import { cn } from '~/utils';
import store from '~/store';

const DETAILS_RE =
  /<details>\s*\n<summary>(?:<b>)?\s*(.*?)\s*(?:<\/b>)?<\/summary>\s*\n\n([\s\S]*?)\n\n<\/details>/g;

const parseDetailsBlocks = (
  text: string,
): { blocks: { title: string; body: string }[]; content: string } => {
  const blocks: { title: string; body: string }[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(DETAILS_RE.source, DETAILS_RE.flags);
  while ((match = re.exec(text)) !== null) {
    blocks.push({ title: match[1].trim(), body: match[2].trim() });
  }
  const content = text.replace(DETAILS_RE, '').trim();
  return { blocks, content };
};

type TextPartProps = {
  text: string;
  showCursor: boolean;
  isCreatedByUser: boolean;
};

type ContentType =
  | ReactElement<React.ComponentProps<typeof Markdown>>
  | ReactElement<React.ComponentProps<typeof MarkdownLite>>
  | ReactElement;

const TextPart = memo(function TextPart({ text, isCreatedByUser, showCursor }: TextPartProps) {
  const { isSubmitting = false, isLatestMessage = false, messageId = '' } = useMessageContext();
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);
  const showCursorState = useMemo(() => showCursor && isSubmitting, [showCursor, isSubmitting]);

  const { blocks: detailsBlocks, content: remainingText } = useMemo(
    () => (isCreatedByUser ? { blocks: [], content: text } : parseDetailsBlocks(text)),
    [text, isCreatedByUser],
  );

  const content: ContentType = useMemo(() => {
    if (!isCreatedByUser) {
      return <Markdown content={remainingText} isLatestMessage={isLatestMessage} />;
    } else if (enableUserMsgMarkdown) {
      return <MarkdownLite content={remainingText} />;
    } else {
      return <>{remainingText}</>;
    }
  }, [isCreatedByUser, enableUserMsgMarkdown, remainingText, isLatestMessage]);

  return (
    <>
      {detailsBlocks.map((block, idx) => (
        <Collapsible
          key={`details-${messageId}-${idx}`}
          title={block.title}
          content={block.body}
        />
      ))}
      <div
        className={cn(
          isSubmitting ? 'submitting' : '',
          showCursorState && !!text.length ? 'result-streaming' : '',
          'markdown prose message-content dark:prose-invert light w-full break-words',
          isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
          isCreatedByUser ? 'dark:text-gray-20' : 'dark:text-gray-100',
        )}
      >
        {content}
      </div>
    </>
  );
});
TextPart.displayName = 'TextPart';

export default TextPart;
