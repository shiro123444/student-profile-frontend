import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Note, NoteFolder } from '../../services/api'
import NoteSidebar from './NoteSidebar'

const rootFolder: NoteFolder = {
  id: 'folder-a',
  student_id: 'student-1',
  name: 'Projects',
  parent_id: null,
  path: '/Projects',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const rootNote: Note = {
  id: 'note-root',
  title: 'Root Note',
  content: '',
  folder: '/',
  folder_id: null,
  sort_order: 0,
  tags: [],
  is_public: false,
  word_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const childNote: Note = {
  id: 'note-child',
  title: 'Child Note',
  content: '',
  folder: '/Projects',
  folder_id: 'folder-a',
  sort_order: 0,
  tags: ['work'],
  is_public: false,
  word_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('NoteSidebar tree rendering', () => {
  it('renders mixed tree and toggles folder expand/collapse', () => {
    render(
      <NoteSidebar
        folders={[rootFolder]}
        notes={[rootNote, childNote]}
        activeNoteId={null}
        onSelectNote={vi.fn()}
        onNewNote={vi.fn()}
        onSearch={vi.fn()}
        onCreateFolder={vi.fn()}
      />,
    )

    expect(screen.getByText('Root Note')).toBeInTheDocument()
    expect(screen.queryByText('Child Note')).not.toBeInTheDocument()

    const toggle = screen.getByTitle('展开')
    fireEvent.click(toggle)

    expect(screen.getByText('Child Note')).toBeInTheDocument()

    const collapse = screen.getByTitle('收起')
    fireEvent.click(collapse)

    expect(screen.queryByText('Child Note')).not.toBeInTheDocument()
  })
})
