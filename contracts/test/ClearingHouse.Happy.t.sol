// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ClearingHouseTestBase} from "./ClearingHouse.Base.t.sol";
import {ClearingHouse} from "../ClearingHouse.sol";
import {Vm} from "forge-std/Vm.sol";

contract ClearingHouseHappyTest is ClearingHouseTestBase {
    // ---------- deployment / circle ----------
    function test_ConstructorStoresToken() public view {
        assertEq(address(ch.usdc()), address(usdc));
        assertEq(ch.MAX_MEMBERS(), 32);
        assertEq(ch.MIN_CYCLE(), 1 hours);
        assertEq(ch.MAX_CYCLE(), 90 days);
    }

    function test_CreateCircleInitialState() public view {
        ClearingHouse.Circle memory c = ch.getCircle(cid);
        assertEq(c.admin, admin);
        assertEq(c.cycleDuration, CYCLE);
        assertEq(c.cycleStart, start);
        assertEq(c.currentCycle, 1);
        assertFalse(c.paused);
        assertEq(c.cycleObligationCount, 0);
        assertEq(c.cycleGross, 0);
        assertEq(ch.circleCount(), 1);
        assertEq(ch.cycleEndsAt(cid), start + CYCLE);
    }

    function test_CreateCircleSecondGetsNewId() public {
        vm.prank(bob);
        uint256 id2 = ch.createCircle("Other", 1 hours);
        assertEq(id2, 2);
        assertEq(ch.getCircle(2).admin, bob);
        assertTrue(ch.isMember(2, bob));
        assertFalse(ch.isMember(2, admin));
    }

    function test_CreateCircleAcceptsBoundaryDurations() public {
        vm.prank(bob);
        ch.createCircle("min", 1 hours);
        vm.prank(bob);
        ch.createCircle("max", 90 days);
        assertEq(ch.circleCount(), 3);
    }

    // ---------- membership ----------
    function test_InviteAndJoin() public {
        vm.prank(admin);
        ch.inviteMember(cid, dave);
        assertTrue(ch.isInvited(cid, dave));
        vm.prank(dave);
        ch.join(cid);
        assertTrue(ch.isMember(cid, dave));
        assertFalse(ch.isInvited(cid, dave));
        assertEq(ch.getMembers(cid).length, 4);
    }

    function test_RevokeInvitePreventsJoin() public {
        vm.prank(admin);
        ch.inviteMember(cid, dave);
        vm.prank(admin);
        ch.revokeInvite(cid, dave);
        assertFalse(ch.isInvited(cid, dave));
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotInvited.selector);
        ch.join(cid);
    }

    function test_LeaveSwapAndPop() public {
        // members: [admin, bob, carol]; bob leaves -> [admin, carol]
        vm.prank(bob);
        ch.leave(cid);
        assertFalse(ch.isMember(cid, bob));
        address[] memory ms = ch.getMembers(cid);
        assertEq(ms.length, 2);
        assertEq(ms[0], admin);
        assertEq(ms[1], carol);
        // moved member can still leave (index bookkeeping correct)
        vm.prank(carol);
        ch.leave(cid);
        assertEq(ch.getMembers(cid).length, 1);
        // can rejoin after fresh invite
        _join(cid, bob);
        assertTrue(ch.isMember(cid, bob));
    }

    function test_LeaveAfterWithdrawingEverything() public {
        _fund(cid, bob, 50e6);
        vm.prank(bob);
        ch.withdraw(cid, 50e6, bob);
        vm.prank(bob);
        ch.leave(cid);
        assertFalse(ch.isMember(cid, bob));
    }

    // ---------- deposit / withdraw ----------
    function test_DepositCreditsBalanceAndMovesTokens() public {
        _fund(cid, bob, 100e6);
        assertEq(ch.balanceOf(cid, bob), 100e6);
        assertEq(ch.totalBalances(), 100e6);
        assertEq(usdc.balanceOf(address(ch)), 100e6);
        assertEq(usdc.balanceOf(bob), 0);
        assertEq(ch.withdrawableOf(cid, bob), 100e6);
    }

    function test_WithdrawToOtherAddress() public {
        _fund(cid, bob, 100e6);
        vm.prank(bob);
        ch.withdraw(cid, 40e6, dave);
        assertEq(usdc.balanceOf(dave), 40e6);
        assertEq(ch.balanceOf(cid, bob), 60e6);
        assertEq(ch.totalBalances(), 60e6);
        assertEq(usdc.balanceOf(address(ch)), 60e6);
    }

    function test_BalancesAreSeparatePerCircle() public {
        vm.prank(bob);
        uint256 id2 = ch.createCircle("Other", 1 days);
        _fund(cid, bob, 10e6);
        _fund(id2, bob, 25e6);
        assertEq(ch.balanceOf(cid, bob), 10e6);
        assertEq(ch.balanceOf(id2, bob), 25e6);
        assertEq(ch.totalBalances(), 35e6);
    }

    // ---------- obligations ----------
    function test_ProposeStoresObligation() public {
        uint256 oid = _propose(cid, bob, admin, 70e6);
        assertEq(oid, 1);
        assertEq(ch.obligationCount(), 1);
        ClearingHouse.Obligation memory o = ch.getObligation(oid);
        assertEq(o.payer, admin);
        assertEq(o.payee, bob);
        assertEq(o.amount, 70e6);
        assertEq(o.circleId, cid);
        assertEq(o.cycle, 1);
        assertEq(uint8(o.status), uint8(ClearingHouse.Status.Proposed));
        assertEq(o.ref, REF);
        // proposal does not move any position
        assertEq(ch.netPositionOf(cid, admin), 0);
        assertEq(ch.netPositionOf(cid, bob), 0);
        assertFalse(ch.isExpired(oid));
    }

    function test_ExplicitAcceptMovesNetPositions() public {
        _fund(cid, admin, 100e6);
        uint256 oid = _propose(cid, bob, admin, 70e6);
        _accept(admin, oid);
        assertEq(uint8(ch.getObligation(oid).status), uint8(ClearingHouse.Status.Accepted));
        assertEq(ch.netPositionOf(cid, admin), -70e6);
        assertEq(ch.netPositionOf(cid, bob), 70e6);
        // balance unchanged until close; payer withdrawable reduced, payee credit not yet withdrawable
        assertEq(ch.balanceOf(cid, admin), 100e6);
        assertEq(ch.withdrawableOf(cid, admin), 30e6);
        assertEq(ch.withdrawableOf(cid, bob), 0);
        ClearingHouse.Circle memory c = ch.getCircle(cid);
        assertEq(c.cycleGross, 70e6);
        assertEq(c.cycleObligationCount, 1);
        assertEq(_sumNets(cid), 0);
    }

    function test_PayeeCreditCountsAsCoverageForOnwardInvoice() public {
        // bob has zero collateral but receives 100 from admin, so he can accept paying 90 to carol
        _fund(cid, admin, 100e6);
        _proposeAccept(cid, bob, admin, 100e6);
        uint256 oid = _propose(cid, carol, bob, 90e6);
        _accept(bob, oid);
        assertEq(ch.netPositionOf(cid, bob), 10e6);
    }

    function test_RejectByPayer() public {
        uint256 oid = _propose(cid, bob, admin, 10e6);
        vm.prank(admin);
        ch.rejectObligation(oid);
        assertEq(uint8(ch.getObligation(oid).status), uint8(ClearingHouse.Status.Rejected));
    }

    function test_CancelByPayee() public {
        uint256 oid = _propose(cid, bob, admin, 10e6);
        vm.prank(bob);
        ch.cancelObligation(oid);
        assertEq(uint8(ch.getObligation(oid).status), uint8(ClearingHouse.Status.Cancelled));
    }

    // ---------- policy / auto accept ----------
    function test_SetPolicyStoresLimits() public {
        vm.prank(admin);
        ch.setPolicy(cid, bob, 50e6, 80e6);
        ClearingHouse.Policy memory p = ch.policyOf(cid, admin, bob);
        assertEq(p.perObligationLimit, 50e6);
        assertEq(p.perCycleLimit, 80e6);
    }

    function test_AutoAcceptViaPolicy() public {
        _fund(cid, admin, 200e6);
        vm.prank(admin);
        ch.setPolicy(cid, bob, 50e6, 80e6);

        uint256 o1 = _propose(cid, bob, admin, 40e6);
        assertEq(uint8(ch.getObligation(o1).status), uint8(ClearingHouse.Status.Accepted));
        assertEq(ch.netPositionOf(cid, admin), -40e6);
        assertEq(ch.autoUsedOf(cid, 1, admin, bob), 40e6);

        uint256 o2 = _propose(cid, bob, admin, 40e6); // exactly hits per-cycle limit
        assertEq(uint8(ch.getObligation(o2).status), uint8(ClearingHouse.Status.Accepted));
        assertEq(ch.autoUsedOf(cid, 1, admin, bob), 80e6);

        uint256 o3 = _propose(cid, bob, admin, 1); // exceeds per-cycle
        assertEq(uint8(ch.getObligation(o3).status), uint8(ClearingHouse.Status.Proposed));
        assertEq(ch.netPositionOf(cid, admin), -80e6);
    }

    function test_AutoAcceptSkippedAbovePerObligationLimit() public {
        _fund(cid, admin, 200e6);
        vm.prank(admin);
        ch.setPolicy(cid, bob, 50e6, 500e6);
        uint256 o = _propose(cid, bob, admin, 51e6);
        assertEq(uint8(ch.getObligation(o).status), uint8(ClearingHouse.Status.Proposed));
    }

    function test_AutoAcceptSkippedWithoutCoverageButDoesNotRevert() public {
        _fund(cid, admin, 10e6);
        vm.prank(admin);
        ch.setPolicy(cid, bob, 50e6, 500e6);
        uint256 o = _propose(cid, bob, admin, 20e6);
        assertEq(uint8(ch.getObligation(o).status), uint8(ClearingHouse.Status.Proposed));
    }

    function test_PolicyRevokedByZeroLimits() public {
        _fund(cid, admin, 100e6);
        vm.startPrank(admin);
        ch.setPolicy(cid, bob, 50e6, 80e6);
        ch.setPolicy(cid, bob, 0, 0);
        vm.stopPrank();
        uint256 o = _propose(cid, bob, admin, 10e6);
        assertEq(uint8(ch.getObligation(o).status), uint8(ClearingHouse.Status.Proposed));
    }

    function test_AutoUsedResetsInNextCycle() public {
        _fund(cid, admin, 200e6);
        vm.prank(admin);
        ch.setPolicy(cid, bob, 80e6, 80e6);
        _propose(cid, bob, admin, 80e6);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        assertEq(ch.autoUsedOf(cid, 2, admin, bob), 0);
        uint256 o = _propose(cid, bob, admin, 80e6);
        assertEq(uint8(ch.getObligation(o).status), uint8(ClearingHouse.Status.Accepted));
        assertEq(ch.autoUsedOf(cid, 2, admin, bob), 80e6);
    }

    function test_PolicySurvivesLeaveAndRejoin() public {
        vm.prank(bob);
        ch.setPolicy(cid, carol, 5e6, 6e6);
        vm.prank(bob);
        ch.leave(cid);
        _join(cid, bob);
        assertEq(ch.policyOf(cid, bob, carol).perObligationLimit, 5e6);
    }

    // ---------- closeCycle / netting ----------
    function _ring() internal returns (uint256 o1, uint256 o2, uint256 o3) {
        _fund(cid, admin, 100e6);
        _fund(cid, bob, 100e6);
        _fund(cid, carol, 100e6);
        // admin owes bob 100, bob owes carol 90, carol owes admin 80
        o1 = _proposeAccept(cid, bob, admin, 100e6);
        o2 = _proposeAccept(cid, carol, bob, 90e6);
        o3 = _proposeAccept(cid, admin, carol, 80e6);
    }

    function test_ThreePartyRingNetsFarBelowGross() public {
        _ring();
        assertEq(ch.netPositionOf(cid, admin), -20e6);
        assertEq(ch.netPositionOf(cid, bob), 10e6);
        assertEq(ch.netPositionOf(cid, carol), 10e6);
        assertEq(_sumNets(cid), 0);
        assertEq(ch.getCircle(cid).cycleGross, 270e6);

        vm.warp(_endOfCycle());
        // anyone can close
        vm.recordLogs();
        vm.prank(dave);
        ch.closeCycle(cid);
        // net volume (20) << gross volume (270): assert via the event payload
        (uint256 gross, uint256 netVol, uint32 n, uint64 nextStart) = _lastCycleClosed();
        assertEq(gross, 270e6);
        assertEq(netVol, 20e6);
        assertLt(netVol * 10, gross);
        assertEq(n, 3);
        assertEq(nextStart, start + CYCLE);

        assertEq(ch.balanceOf(cid, admin), 80e6);
        assertEq(ch.balanceOf(cid, bob), 110e6);
        assertEq(ch.balanceOf(cid, carol), 110e6);
        assertEq(ch.netPositionOf(cid, admin), 0);
        assertEq(ch.totalBalances(), 300e6);
        assertEq(usdc.balanceOf(address(ch)), 300e6);
        ClearingHouse.Circle memory c = ch.getCircle(cid);
        assertEq(c.currentCycle, 2);
        assertEq(c.cycleStart, start + CYCLE);
        assertEq(c.cycleGross, 0);
        assertEq(c.cycleObligationCount, 0);
    }

    function test_FullyBalancedRingHasZeroNetVolume() public {
        _fund(cid, admin, 100e6);
        _proposeAccept(cid, bob, admin, 100e6);
        _proposeAccept(cid, carol, bob, 100e6);
        _proposeAccept(cid, admin, carol, 100e6); // carol covered by +100 credit
        assertEq(ch.netPositionOf(cid, admin), 0);
        assertEq(ch.netPositionOf(cid, bob), 0);
        assertEq(ch.netPositionOf(cid, carol), 0);
        vm.warp(_endOfCycle());
        vm.recordLogs();
        ch.closeCycle(cid);
        (uint256 gross, uint256 netVol,,) = _lastCycleClosed();
        assertEq(gross, 300e6);
        assertEq(netVol, 0);
        assertEq(ch.balanceOf(cid, admin), 100e6);
    }

    function test_WithdrawAfterCloseOfCredit() public {
        _ring();
        // pre-close: bob's credit is not withdrawable beyond balance
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.InsufficientBalance.selector);
        ch.withdraw(cid, 101e6, bob);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        vm.prank(bob);
        ch.withdraw(cid, 110e6, bob);
        assertEq(usdc.balanceOf(bob), 110e6);
        assertEq(ch.balanceOf(cid, bob), 0);
        vm.prank(admin);
        ch.withdraw(cid, 80e6, admin);
        vm.prank(carol);
        ch.withdraw(cid, 110e6, carol);
        assertEq(ch.totalBalances(), 0);
        assertEq(usdc.balanceOf(address(ch)), 0);
    }

    function test_WithdrawLimitedByOpenNetDebit() public {
        _fund(cid, admin, 100e6);
        _proposeAccept(cid, bob, admin, 70e6);
        vm.startPrank(admin);
        vm.expectRevert(ClearingHouse.InsufficientCoverage.selector);
        ch.withdraw(cid, 31e6, admin);
        ch.withdraw(cid, 30e6, admin);
        vm.stopPrank();
        assertEq(ch.balanceOf(cid, admin), 70e6);
    }

    function test_EmptyCycleCloseSkipsLoop() public {
        _fund(cid, bob, 5e6);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        assertEq(ch.getCircle(cid).currentCycle, 2);
        assertEq(ch.balanceOf(cid, bob), 5e6);
    }

    function test_ExpiredProposalCannotBeAcceptedButCanBeRejected() public {
        _fund(cid, admin, 100e6);
        uint256 oid = _propose(cid, bob, admin, 10e6);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        assertTrue(ch.isExpired(oid));
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.StaleObligation.selector);
        ch.acceptObligation(oid);
        vm.prank(admin);
        ch.rejectObligation(oid);
        assertFalse(ch.isExpired(oid));
    }

    // ---------- multi-cycle catch-up ----------
    function test_MultiCycleCatchUpViaRepeatedClose() public {
        _fund(cid, admin, 100e6);
        _proposeAccept(cid, bob, admin, 60e6);
        vm.warp(start + 3 * uint256(CYCLE) + 1);

        ch.closeCycle(cid); // cycle 1: settles
        assertEq(ch.balanceOf(cid, bob), 60e6);
        assertEq(ch.balanceOf(cid, admin), 40e6);
        assertEq(ch.getCircle(cid).currentCycle, 2);
        assertEq(ch.getCircle(cid).cycleStart, start + CYCLE);

        ch.closeCycle(cid); // cycle 2: empty
        ch.closeCycle(cid); // cycle 3: empty
        ClearingHouse.Circle memory c = ch.getCircle(cid);
        assertEq(c.currentCycle, 4);
        assertEq(c.cycleStart, start + 3 * uint256(CYCLE)); // calendar aligned, not reset to now
        assertEq(ch.cycleEndsAt(cid), start + 4 * uint256(CYCLE));

        vm.expectRevert(ClearingHouse.CycleNotEnded.selector);
        ch.closeCycle(cid);

        // new proposals land in cycle 4
        uint256 oid = _propose(cid, bob, admin, 1);
        assertEq(ch.getObligation(oid).cycle, 4);
    }

    // ---------- helper ----------
    function _lastCycleClosed()
        internal
        returns (uint256 gross, uint256 netVol, uint32 n, uint64 nextStart)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = ClearingHouse.CycleClosed.selector;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == sig) {
                (gross, netVol, n, nextStart) = abi.decode(logs[i].data, (uint256, uint256, uint32, uint64));
            }
        }
    }
}
