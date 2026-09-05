'use client';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { useEffect } from 'react';
if (typeof window !== 'undefined') {
  (
    globalThis as typeof globalThis & { MonacoEnvironment: unknown }
  ).MonacoEnvironment = { getWorker: () => new EditorWorker() };
  loader.config({ monaco });
}
export default function CodeEditor({
  value,
  onChange,
  language = 'cpp',
  original,
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  original?: string;
  readOnly?: boolean;
}) {
  useEffect(() => {
    monaco.editor.defineTheme('neo-space', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0b1020',
        'editorLineNumber.foreground': '#586582',
        'editor.lineHighlightBackground': '#131b30',
        'editor.selectionBackground': '#7059c44d',
      },
    });
  }, []);
  const options: monaco.editor.IStandaloneEditorConstructionOptions = {
    fontSize: 15,
    fontFamily: 'Consolas, monospace',
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 4,
    readOnly,
    padding: { top: 20 },
    accessibilitySupport: 'on',
  };
  return original !== undefined ? (
    <DiffEditor
      height="100%"
      language={language}
      theme="neo-space"
      original={original}
      modified={value}
      options={{ ...options, renderSideBySide: true, originalEditable: false }}
    />
  ) : (
    <Editor
      height="100%"
      language={language}
      theme="neo-space"
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      options={options}
    />
  );
}
