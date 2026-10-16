import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NearbyResult } from './NearbyResult'
import { nearbyFixture } from '../test/nearbyFixture'

const props = { loading: false, error: null, unsupported: false, selected: true, onRetry: vi.fn() }

describe('nearby list disclosure', () => {
  it('starts with five rows and expands only the received list without another request', () => {
    render(<NearbyResult {...props} result={nearbyFixture(undefined, 150)} />)
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('150개', { selector: 'strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '현재 받은 목록 100개 모두 보기' }))
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: '가까운 5개만 보기' }))
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5)
  })

  it('collapses a previously expanded list when a new location result arrives', () => {
    const view = render(<NearbyResult {...props} result={nearbyFixture(undefined, 20)} />)
    fireEvent.click(screen.getByRole('button', { name: '현재 받은 목록 20개 모두 보기' }))
    view.rerender(<NearbyResult {...props} result={nearbyFixture({ lat: 37.58, lng: 126.99 }, 30)} />)
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('button', { name: '현재 받은 목록 30개 모두 보기' })).toHaveAttribute('aria-expanded', 'false')
  })
})
