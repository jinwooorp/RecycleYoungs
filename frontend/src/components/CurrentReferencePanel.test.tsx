import { render,screen,fireEvent,waitFor } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import { CurrentReferencePanel } from './CurrentReferencePanel'
import * as api from '../api/referenceApi'
import { ApiFailure } from '../api/adminDongApi'

it('loads only after opening and distinguishes unavailable catalog from historical statistics',async()=>{
  const request=vi.spyOn(api,'getReferenceCatalog').mockRejectedValue(new ApiFailure('http',{
    code:'CONTEXT_UNAVAILABLE',message:'미제공',field:null},503))
  render(<CurrentReferencePanel dataVersion={'a'.repeat(64)} />)
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('현재 원천 목록 살펴보기'))
  await waitFor(()=>expect(request).toHaveBeenCalledOnce())
  expect(await screen.findByText(/현재 환경에는 새 참고 목록이 제공되지 않습니다/)).toBeInTheDocument()
  expect(screen.getByText(/선택 분기·행정동·반경 500m의 통계가 아닙니다/)).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'참고 목록 다시 조회'})).toBeInTheDocument()
  vi.restoreAllMocks()
})
