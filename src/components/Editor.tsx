import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { useEffect, useRef } from 'react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
} from 'lucide-react'
import { cn } from '../lib/utils'

/** Split YAML frontmatter off so the rich editor doesn't turn it into a horizontal rule. */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/)
  if (!m) return { frontmatter: null, body: md }
  return { frontmatter: m[0].trimEnd(), body: md.slice(m[0].length).replace(/^\n/, '') }
}

export function joinFrontmatter(frontmatter: string | null, body: string) {
  return frontmatter ? `${frontmatter}\n\n${body}` : body
}

type Props = {
  markdown: string
  editable: boolean
  onChange: (markdown: string) => void
  onSave?: () => void
}

export function MarkdownEditor({ markdown, editable, onChange, onSave }: Props) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: markdown,
    contentType: 'markdown',
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          event.preventDefault()
          saveRef.current?.()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.docChanged) onChange(editor.getMarkdown())
    },
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  return (
    <div className="doc-surface">
      {editable && editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="px-1 pt-6 pb-24" />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('grid size-7 place-items-center rounded text-ink-2 hover:bg-wash hover:text-ink [&>svg]:size-4', active && 'bg-wash text-ink')}
    >
      {icon}
    </button>
  )
  const c = () => editor.chain().focus()
  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-0.5 border-b border-line bg-sheet/95 py-1.5 backdrop-blur">
      {btn(editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), <Heading1 />, 'Heading 1')}
      {btn(editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), <Heading2 />, 'Heading 2')}
      {btn(editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), <Heading3 />, 'Heading 3')}
      <span className="mx-1 h-4 w-px bg-line" />
      {btn(editor.isActive('bold'), () => c().toggleBold().run(), <Bold />, 'Bold')}
      {btn(editor.isActive('italic'), () => c().toggleItalic().run(), <Italic />, 'Italic')}
      {btn(editor.isActive('strike'), () => c().toggleStrike().run(), <Strikethrough />, 'Strikethrough')}
      {btn(editor.isActive('code'), () => c().toggleCode().run(), <Code />, 'Inline code')}
      {btn(
        editor.isActive('link'),
        () => {
          if (editor.isActive('link')) return c().unsetLink().run()
          const url = window.prompt('Link URL')
          if (url) c().setLink({ href: url }).run()
        },
        <Link2 />,
        'Link',
      )}
      <span className="mx-1 h-4 w-px bg-line" />
      {btn(editor.isActive('bulletList'), () => c().toggleBulletList().run(), <List />, 'Bulleted list')}
      {btn(editor.isActive('orderedList'), () => c().toggleOrderedList().run(), <ListOrdered />, 'Numbered list')}
      {btn(editor.isActive('taskList'), () => c().toggleTaskList().run(), <ListChecks />, 'Checklist')}
      {btn(editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <Quote />, 'Quote')}
      {btn(editor.isActive('codeBlock'), () => c().toggleCodeBlock().run(), <SquareCode />, 'Code block')}
      {btn(false, () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), <Table />, 'Table')}
      {btn(false, () => c().setHorizontalRule().run(), <Minus />, 'Divider')}
    </div>
  )
}

export function PlainEditor({ value, editable, onChange, onSave }: { value: string; editable: boolean; onChange: (v: string) => void; onSave?: () => void }) {
  return (
    <textarea
      value={value}
      readOnly={!editable}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          onSave?.()
        }
      }}
      className="mt-6 min-h-[65vh] w-full resize-y rounded-lg border border-line bg-paper/50 p-4 font-mono text-[13px] leading-relaxed text-ink focus:border-line-2 focus:outline-none"
    />
  )
}
