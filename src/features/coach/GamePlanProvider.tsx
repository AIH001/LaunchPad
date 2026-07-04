import { type ReactNode } from 'react'
import { useGamePlanState } from './useGamePlanState'
import { GamePlanContext } from './GamePlanContext'

// Holds the game plan for the whole session so it survives tab switches. Does not
// generate on its own — the GamePlan screen kicks off the first generation when
// it's opened (see GamePlan.tsx).
export function GamePlanProvider({ children }: { children: ReactNode }) {
  const value = useGamePlanState()
  return <GamePlanContext.Provider value={value}>{children}</GamePlanContext.Provider>
}
