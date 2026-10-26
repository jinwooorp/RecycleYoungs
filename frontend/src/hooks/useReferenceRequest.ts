import { useEffect,useState } from 'react'
import { ApiFailure } from '../api/adminDongApi'

export function useReferenceRequest<T>(key:string,load:(signal:AbortSignal)=>Promise<T>) {
  const [settled,setSettled]=useState<{key:string;value:T|null;error:string|null}|null>(null)
  useEffect(()=>{
    if (!key) return
    const controller=new AbortController()
    load(controller.signal).then(value=>{
      if (!controller.signal.aborted) setSettled({key,value,error:null})
    }).catch(error=>{
      if (controller.signal.aborted) return
      const unavailable=error instanceof ApiFailure && [404,503].includes(error.status ?? 0)
      setSettled({key,value:null,error:unavailable?'현재 환경에는 새 참고 목록이 제공되지 않습니다. 기존 카페 통계와 점수는 별도로 조회할 수 있습니다.'
        :error instanceof ApiFailure && error.status===409?'자료 버전이 변경됐습니다. 데이터 안내를 닫고 조회 조건을 새로 불러와 주세요.'
          :'참고 목록을 불러오지 못했습니다. 다시 조회해 주세요.'})
    })
    return ()=>controller.abort()
  },[key,load])
  return settled?.key===key?{value:settled.value,error:settled.error,loading:false}:{value:null,error:null,loading:!!key}
}
