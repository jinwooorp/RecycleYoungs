import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { normalTrend } from '../test/trendFixture'
import { TrendResult } from './TrendResult'

it('추세 제목과 전체 표가 실제 공개 기간의 연도 경계를 반영한다',()=>{
  const codes=['20254','20261','20262']
  const trend={...normalTrend,quarters:codes.map((code,i)=>({...normalTrend.quarters[i],
    quarter:{code,label:`${code.slice(0,4)}년 ${code[4]}분기`}}))}
  render(<TrendResult trend={trend}/>)
  expect(screen.getByRole('heading',{name:'2025년 4분기~2026년 2분기 추세'})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'전체 기간 자료 보기'}))
  expect(screen.getAllByRole('columnheader',{name:'2026년 1분기'})).toHaveLength(2)
})
