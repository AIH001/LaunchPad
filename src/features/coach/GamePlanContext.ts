import { createContext, useContext } from 'react'
import type { useGamePlanState } from './useGamePlanState'

export type GamePlanContextValue = ReturnType<typeof useGamePlanState>

export const GamePlanContext = createContext<GamePlanContextValue | undefined>(undefined)

// Consume the shared game plan. Because state lives in <GamePlanProvider>, a plan
// generated once persists across navigation — returning to the tab shows it
// instantly rather than regenerating (an expensive Sonnet call).
export function useGamePlan() {
  const ctx = useContext(GamePlanContext)
  if (!ctx) {
    throw new Error('useGamePlan must be used within a <GamePlanProvider>')
  }
  return ctx
}
