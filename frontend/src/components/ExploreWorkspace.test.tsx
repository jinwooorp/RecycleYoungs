import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ExploreWorkspace } from './ExploreWorkspace'
import { useState } from 'react'

it('shows one hamburger in the dock or map and transfers keyboard focus when toggled', () => {
  function Workspace() {
    const [collapsed, setCollapsed] = useState(false)
    return <ExploreWorkspace summary="명동" collapsed={collapsed} onCollapsedChange={setCollapsed} panel={<p>점수</p>} map={<p>지도</p>} />
  }
  render(<Workspace />)
  const close = screen.getByRole('button', { name: '분석 패널 닫기' })
  expect(close.closest('aside')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '분석 패널 열기' })).not.toBeInTheDocument()
  fireEvent.click(close)
  const open = screen.getByRole('button', { name: '분석 패널 열기' })
  expect(open.closest('.map-workspace')).toBeTruthy()
  expect(open).toHaveFocus()
  fireEvent.click(open)
  expect(screen.getByRole('button', { name: '분석 패널 닫기' })).toHaveFocus()
})

it('removes the collapsed dock from navigation and opens it from a map hamburger', () => {
  const change = vi.fn()
  render(<ExploreWorkspace summary="명동" collapsed onCollapsedChange={change} panel={<button>패널 조작</button>} map={<p>지도</p>} />)
  expect(screen.queryByRole('complementary', { name: '위치 분석 패널' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '패널 조작' })).not.toBeInTheDocument()
  const open = screen.getByRole('button', { name: '분석 패널 열기' })
  expect(open).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(open)
  expect(change).toHaveBeenCalledWith(false)
})
