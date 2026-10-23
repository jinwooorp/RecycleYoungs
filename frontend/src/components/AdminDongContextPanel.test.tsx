import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AdminDongContextPanel } from './AdminDongContextPanel'
import { contextFixture } from '../test/contextFixture'

it('shows exact reference values and source limits without excluded fields or fabricated scores', () => {
  render(<AdminDongContextPanel result={contextFixture()} detailed />)
  expect(screen.getAllByText(/9,007,199,254,740,993.25/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/원천 값 미제공/).length).toBeGreaterThan(0)
  expect(screen.getByText(/음수 자료와 원천 정의 충돌/)).toBeInTheDocument()
  expect(screen.getAllByText(/실제 관측일/).length).toBeGreaterThan(0)
  expect(screen.queryByText('아파트 가구 수')).not.toBeInTheDocument()
  expect(screen.queryByText('시설 총수')).not.toBeInTheDocument()
})

it('distinguishes no row from no period and keeps a context failure separate', () => {
  const fixture = contextFixture()
  fixture.sections.workers = {...fixture.sections.workers,state:'NO_ROW',metrics:null,attributes:null,
    provenance:{...fixture.sections.workers.provenance,sourceQuarter:null}}
  fixture.sections.population = {...fixture.sections.population,state:'NO_PERIOD',metrics:null,attributes:null,
    provenance:{...fixture.sections.population.provenance,sourceQuarter:null}}
  const { rerender } = render(<AdminDongContextPanel result={fixture} detailed />)
  expect(screen.getByText(/이 지역의 집계 행이 없습니다/)).toBeInTheDocument()
  expect(screen.getByText(/이 분기의 원천 자료가 없습니다/)).toBeInTheDocument()
  rerender(<AdminDongContextPanel error="참고 자료 미제공" />)
  expect(screen.getByText(/카페 통계와 점수는 별도로/)).toBeInTheDocument()
})
