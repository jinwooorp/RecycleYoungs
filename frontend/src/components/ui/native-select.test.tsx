import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { NativeSelect } from './native-select'
it('keeps a labelled native control and its events while the decorative caret cannot intercept input', () => {
  const change = vi.fn()
  const { container, rerender } = render(<><label htmlFor="filter">분기</label><NativeSelect id="filter" onChange={change}><option value="1">1분기</option><option value="2">2분기</option></NativeSelect></>)
  const select = screen.getByRole('combobox', { name: '분기' })
  expect(select.tagName).toBe('SELECT')
  expect(container.querySelector('[data-slot="native-select-icon"]')).toHaveAttribute('aria-hidden', 'true')
  fireEvent.change(select, { target: { value: '2' } })
  expect(change).toHaveBeenCalledTimes(1)
  rerender(<NativeSelect aria-label="분기" disabled><option>1분기</option></NativeSelect>)
  expect(screen.getByRole('combobox', { name: '분기' })).toBeDisabled()
})
