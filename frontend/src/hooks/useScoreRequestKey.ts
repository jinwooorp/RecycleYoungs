import { useState } from 'react'

// Returning to the same query is a new request, not permission to reuse its last result.
export function useScoreRequestKey(scope: string) {
  const [request, setRequest] = useState({ scope, revision: 0 })
  if (request.scope !== scope) setRequest({ scope, revision: request.revision + 1 })
  return { requestKey: `${scope}:${request.revision}`, retry: () => setRequest(value => ({ ...value, revision: value.revision + 1 })) }
}
