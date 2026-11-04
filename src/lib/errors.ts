import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

const CONTRACT_ERRORS: Record<string, string> = {
  InsufficientCoverage: 'Collateral would not cover your net payables. Add collateral or lower the amount.',
  InsufficientBalance: 'That is more than your settled balance in this circle.',
  CycleOverdue: 'This cycle has ended. Close it first, then continue in the next cycle.',
  CycleNotEnded: 'This cycle has not reached its end yet.',
  StaleObligation: 'This invoice belongs to a closed cycle. Ask the issuer to send it again.',
  CircleIsPaused: 'The circle admin has paused new activity. Withdrawals and cycle closing still work.',
  NotMember: 'One of the parties is not a member of this circle.',
  NotInvited: 'You have not been invited to this circle.',
  AlreadyMember: 'Already a member.',
  MemberLimitReached: 'This circle has reached its 32-member limit.',
  InvalidCycleDuration: 'Cycle length must be between 1 hour and 90 days.',
  AdminCannotLeave: 'The circle admin cannot leave.',
  OutstandingPosition: 'Withdraw your collateral and wait for your net position to settle before leaving.',
  ZeroAmount: 'Enter an amount greater than zero.',
  ZeroAddress: 'A valid address is required.',
  SameParticipant: 'Payer and payee must be different members.',
  NotPayer: 'Only the payer can do this.',
  NotPayee: 'Only the invoice issuer can do this.',
  NotProposed: 'This invoice has already been resolved.',
  NotAdmin: 'Only the circle admin can do this.',
  UnknownCircle: 'This circle does not exist.',
  UnknownObligation: 'This invoice does not exist.',
}

export interface DescribedError {
  rejected: boolean
  message: string
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { rejected: true, message: 'You cancelled the request in your wallet.' }
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name) return { rejected: false, message: CONTRACT_ERRORS[name] ?? `The contract rejected this action (${name}).` }
    }
    const short = error.shortMessage
    if (/insufficient funds|exceeds the balance/i.test(short)) {
      return { rejected: false, message: 'Not enough USDC in your wallet to pay network fees. Use Get test USDC in the sidebar.' }
    }
    if (/user rejected|denied/i.test(short)) return { rejected: true, message: 'You cancelled the request in your wallet.' }
    return { rejected: false, message: short }
  }
  if (error instanceof Error) {
    if (/user rejected|denied transaction/i.test(error.message)) return { rejected: true, message: 'You cancelled the request in your wallet.' }
    return { rejected: false, message: error.message }
  }
  return { rejected: false, message: 'Something went wrong. Please try again.' }
}
