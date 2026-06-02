'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { useEffect } from 'react'

interface ReportEditorProps {
  content: string
  onChange: (html: string) => void
  editable?: boolean
}

export default function ReportEditor({
  content,
  onChange,
  editable = true,
}: ReportEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editor, editable])

  if (!editor) return null

  const tbBtn = (active = false): React.CSSProperties => ({
    width: 28, height: 26, borderRadius: 4, border: 'none',
    cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? '#edf2fb' : 'none',
    color: active ? '#2c5282' : '#2c2a27',
    transition: 'all .1s',
    fontFamily: "'Outfit', sans-serif",
  })

  const Sep = () => (
    <div style={{ width: 1, height: 18, background: '#e4e0d9', margin: '0 4px', flexShrink: 0 }} />
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: '#ffffff',
      border: '1px solid #e4e0d9', borderRadius: 0,
      overflow: 'hidden',
    }}>
      {/* TOOLBAR */}
      {editable && (
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: 2, padding: '6px 10px',
          borderBottom: '1px solid #e4e0d9',
          background: '#f8f7f5', flexShrink: 0,
        }}>
          {/* Heading selector */}
          <select
            onChange={e => {
              const val = e.target.value
              if (val === 'p') editor.chain().focus().setParagraph().run()
              else editor.chain().focus().toggleHeading({ level: parseInt(val) as 1 | 2 | 3 }).run()
            }}
            value={
              editor.isActive('heading', { level: 1 }) ? '1'
              : editor.isActive('heading', { level: 2 }) ? '2'
              : editor.isActive('heading', { level: 3 }) ? '3'
              : 'p'
            }
            style={{
              height: 26, fontSize: 11, border: '1px solid #e4e0d9',
              borderRadius: 4, padding: '0 6px', color: '#2c2a27',
              background: '#fff', fontFamily: "'Outfit', sans-serif", cursor: 'pointer',
            }}
          >
            <option value="p">Normal</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>

          <Sep />

          {/* Bold Italic Underline Strike */}
          <button title="Bold" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}
            style={tbBtn(editor.isActive('bold'))}>
            <strong>B</strong>
          </button>
          <button title="Italic" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}
            style={tbBtn(editor.isActive('italic'))}>
            <em>I</em>
          </button>
          <button title="Underline" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}
            style={tbBtn(editor.isActive('underline'))}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button title="Strikethrough" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }}
            style={tbBtn(editor.isActive('strike'))}>
            <span style={{ textDecoration: 'line-through' }}>S</span>
          </button>

          <Sep />

          {/* Alignment */}
          {(['left', 'center', 'right'] as const).map(align => (
            <button key={align} title={`Align ${align}`}
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign(align).run() }}
              style={tbBtn(editor.isActive({ textAlign: align }))}>
              {align === 'left' ? '◀' : align === 'center' ? '■' : '▶'}
            </button>
          ))}

          <Sep />

          {/* Lists */}
          <button title="Bullet List" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }}
            style={tbBtn(editor.isActive('bulletList'))}>
            ≡•
          </button>
          <button title="Numbered List" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }}
            style={tbBtn(editor.isActive('orderedList'))}>
            1.
          </button>
          <button title="Indent"  onMouseDown={e => { e.preventDefault(); editor.chain().focus().sinkListItem('listItem').run() }} style={tbBtn()}>→</button>
          <button title="Outdent" onMouseDown={e => { e.preventDefault(); editor.chain().focus().liftListItem('listItem').run() }} style={tbBtn()}>←</button>

          <Sep />

          {/* Highlight */}
          <button title="Highlight"
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: '#fef9c3' }).run() }}
            style={tbBtn(editor.isActive('highlight'))}>
            <span style={{ background: '#fef9c3', padding: '0 2px' }}>H</span>
          </button>

          {/* Text color */}
          <input
            type="color"
            defaultValue="#1a1917"
            title="Text Color"
            onChange={e => { editor.chain().focus().setColor(e.target.value).run() }}
            style={{ width: 22, height: 22, border: '1px solid #e4e0d9', borderRadius: 3, cursor: 'pointer', padding: 1 }}
          />

          <Sep />

          {/* Table */}
          <button title="Insert Table"
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }}
            style={tbBtn()}>
            ⊞
          </button>
          {editor.isActive('table') && <>
            <button title="Add Column" onMouseDown={e => { e.preventDefault(); editor.chain().focus().addColumnAfter().run() }} style={tbBtn()}>+C</button>
            <button title="Add Row"    onMouseDown={e => { e.preventDefault(); editor.chain().focus().addRowAfter().run() }}    style={tbBtn()}>+R</button>
            <button title="Del Table"  onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteTable().run() }}    style={tbBtn()}>✕T</button>
          </>}

          <Sep />

          {/* Clear formatting */}
          <button title="Clear Formatting"
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().clearNodes().unsetAllMarks().run() }}
            style={tbBtn()}>
            ✕
          </button>

          <Sep />

          {/* Undo / Redo */}
          <button title="Undo" onMouseDown={e => { e.preventDefault(); editor.chain().focus().undo().run() }} style={tbBtn()}>↩</button>
          <button title="Redo" onMouseDown={e => { e.preventDefault(); editor.chain().focus().redo().run() }} style={tbBtn()}>↪</button>
        </div>
      )}

      {/* EDITOR CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
        <style>{`
          .report-editor-inner .ProseMirror {
            outline: none;
            min-height: 400px;
            padding: 12px 48px 48px 48px;
            font-family: "Calibri Light", Calibri, Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #000;
            background: #fff;
          }
          .report-editor-inner .ProseMirror h1 {
            font-size: 16pt; font-weight: bold; margin: 16pt 0 6pt;
          }
          .report-editor-inner .ProseMirror h2 {
            font-size: 12pt; font-weight: bold; text-transform: uppercase;
            margin: 14pt 0 4pt; color: #000;
          }
          .report-editor-inner .ProseMirror h3 {
            font-size: 11pt; font-weight: bold; margin: 10pt 0 3pt;
          }
          .report-editor-inner .ProseMirror p { margin: 0 0 6px; }
          .report-editor-inner .ProseMirror ul { list-style: disc; margin: 2px 0 8px 28px; padding: 0; }
          .report-editor-inner .ProseMirror ol { list-style: decimal; margin: 2px 0 8px 28px; padding: 0; }
          .report-editor-inner .ProseMirror li { margin-bottom: 3px; }
          .report-editor-inner .ProseMirror table { border-collapse: collapse; width: 100%; margin: 16px 0; }
          .report-editor-inner .ProseMirror td,
          .report-editor-inner .ProseMirror th { border: 1px solid #e4e0d9; padding: 6px 10px; font-size: 11pt; }
          .report-editor-inner .ProseMirror th { background: #f0ede8; font-weight: bold; }
          .report-editor-inner .ProseMirror img { max-width: 100%; height: auto; margin: 8px 0; }
          .report-editor-inner .ProseMirror strong { font-weight: bold; }
          .report-editor-inner .ProseMirror em { font-style: italic; }
          .report-editor-inner .ProseMirror p.is-editor-empty:first-child::before {
            content: 'Click ✦ AI Report to populate…';
            color: #94a3b8; pointer-events: none; float: left; height: 0;
          }
        `}</style>
        <div className="report-editor-inner">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
