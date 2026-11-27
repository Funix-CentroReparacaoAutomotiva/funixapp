import { createContext, useContext, useEffect } from 'react'

export const TaskRecordContext = createContext<(id: string) => void>(() => {})

export function useTaskRecord(id: string | undefined) {
  const register = useContext(TaskRecordContext)
  useEffect(() => {
    if (!id) return
    register(id)
    return () => register('')
  }, [id, register])
}
