import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { NearbyResult } from './NearbyResult'
import { nearbyFixture } from '../test/nearbyFixture'

it('filters beyond the initial five without describing unidentified stores as independent cafes', () => {
  const result = nearbyFixture({ lat: 37.57, lng: 126.98 })
  result.stores = Array.from({ length: 7 }, (_, i) => ({ sourceStoreId: String(i), name: i === 6 ? '스타벅스 명동점' : `동네 카페 ${i}`, coordinate: result.coordinate, distanceMeters: i + 1 }))
  result.listedCount = 7; result.totalCount = '150'; result.listComplete = false
  const change = vi.fn()
  const props = { result, loading: false, error: null, selected: true, unsupported: false, onRetry: vi.fn(), onFilterChange: change }
  const { rerender } = render(<NearbyResult {...props} filter={{ kind: 'all', brand: '' }} />)
  fireEvent.change(screen.getByLabelText('카페 종류'), { target: { value: 'brand' } })
  expect(change).toHaveBeenCalledWith({ kind: 'brand', brand: '' })
  rerender(<NearbyResult {...props} filter={{ kind: 'brand', brand: '' }} />)
  expect(screen.getByText('스타벅스 명동점')).toBeInTheDocument()
  expect(screen.queryByText('동네 카페 0')).not.toBeInTheDocument()
  expect(screen.getByText(/받은 7개 중 필터 일치 1개/)).toBeInTheDocument()
  expect(within(screen.getByRole('region')).queryByText('개인 카페')).not.toBeInTheDocument()
  expect(result.totalCount).toBe('150')
})
