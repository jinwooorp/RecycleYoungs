import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RegionSelector } from './RegionSelector'
import { regionFixture } from '../test/regionFixture'
it('only commits on submit and clears the dong draft when the district changes', () => {
  const select = vi.fn()
  render(<RegionSelector regions={regionFixture} activeCode="" loading={false} error={null} onRetry={() => {}} onSelect={select} />)
  fireEvent.change(screen.getByLabelText('자치구'), { target: { value: '11110' } })
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11110515' } })
  expect(select).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('자치구'), { target: { value: '11260' } })
  expect(screen.getByLabelText('행정동')).toHaveValue('')
  expect(screen.getByRole('button', { name: '지역 보기' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11260550' } })
  fireEvent.click(screen.getByRole('button', { name: '지역 보기' }))
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ code: '11260550' }))
})
