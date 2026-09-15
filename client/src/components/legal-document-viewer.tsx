import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Thin, prose-styled Markdown renderer shared by every surface that shows
 * Terms and Conditions / Privacy Policy / Data Usage Policy content: the
 * super-admin editor's preview tab, the public /terms /privacy /data-usage
 * pages, the signup-page preview dialog, and the login-flow consent screen.
 * No rehype-raw - raw HTML embedded in the Markdown source is never
 * rendered, so this needs no sanitizer.
 */
export function LegalDocumentViewer({ contentMarkdown, className }: { contentMarkdown: string; className?: string }) {
  return (
    <div
      className={
        "prose prose-sm dark:prose-invert max-w-none " +
        "prose-headings:font-bold prose-a:text-primary prose-img:rounded-lg " +
        (className ?? "")
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentMarkdown}</ReactMarkdown>
    </div>
  );
}

export default LegalDocumentViewer;
