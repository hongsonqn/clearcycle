// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ClearingHouseTestBase} from "./ClearingHouse.Base.t.sol";
import {ClearingHouse} from "../ClearingHouse.sol";

contract ClearingHouseEventsTest is ClearingHouseTestBase {
    function _exp() internal {
        vm.expectEmit(true, true, true, true, address(ch));
    }

    function test_EmitCircleCreated() public {
        _exp();
        emit ClearingHouse.CircleCreated(2, bob, "Other", 1 days, uint64(T0));
        vm.prank(bob);
        ch.createCircle("Other", 1 days);
    }

    function test_EmitMemberInvited() public {
        _exp();
        emit ClearingHouse.MemberInvited(cid, dave);
        vm.prank(admin);
        ch.inviteMember(cid, dave);
    }

    function test_EmitInviteRevoked() public {
        _exp();
        emit ClearingHouse.InviteRevoked(cid, dave);
        vm.prank(admin);
        ch.revokeInvite(cid, dave);
    }

    function test_EmitMemberJoined() public {
        vm.prank(admin);
        ch.inviteMember(cid, dave);
        _exp();
        emit ClearingHouse.MemberJoined(cid, dave);
        vm.prank(dave);
        ch.join(cid);
    }

    function test_EmitMemberLeft() public {
        _exp();
        emit ClearingHouse.MemberLeft(cid, bob);
        vm.prank(bob);
        ch.leave(cid);
    }

    function test_EmitDeposited() public {
        usdc.mint(bob, 5e6);
        vm.startPrank(bob);
        usdc.approve(address(ch), 5e6);
        _exp();
        emit ClearingHouse.Deposited(cid, bob, 5e6);
        ch.deposit(cid, 5e6);
        vm.stopPrank();
    }

    function test_EmitWithdrawn() public {
        _fund(cid, bob, 5e6);
        _exp();
        emit ClearingHouse.Withdrawn(cid, bob, dave, 2e6);
        vm.prank(bob);
        ch.withdraw(cid, 2e6, dave);
    }

    function test_EmitPolicySet() public {
        _exp();
        emit ClearingHouse.PolicySet(cid, bob, carol, 7e6, 9e6);
        vm.prank(bob);
        ch.setPolicy(cid, carol, 7e6, 9e6);
    }

    function test_EmitObligationProposed() public {
        _exp();
        emit ClearingHouse.ObligationProposed(cid, 1, bob, admin, 1, 3e6, REF);
        vm.prank(bob);
        ch.proposeObligation(cid, admin, 3e6, REF);
    }

    function test_EmitObligationAcceptedExplicit() public {
        _fund(cid, admin, 3e6);
        uint256 oid = _propose(cid, bob, admin, 3e6);
        _exp();
        emit ClearingHouse.ObligationAccepted(cid, oid, admin, false);
        vm.prank(admin);
        ch.acceptObligation(oid);
    }

    function test_EmitProposedThenAcceptedAutomatic() public {
        _fund(cid, admin, 3e6);
        vm.prank(admin);
        ch.setPolicy(cid, bob, 3e6, 3e6);
        _exp();
        emit ClearingHouse.ObligationProposed(cid, 1, bob, admin, 1, 3e6, REF);
        _exp();
        emit ClearingHouse.ObligationAccepted(cid, 1, admin, true);
        vm.prank(bob);
        ch.proposeObligation(cid, admin, 3e6, REF);
    }

    function test_EmitObligationRejected() public {
        uint256 oid = _propose(cid, bob, admin, 3e6);
        _exp();
        emit ClearingHouse.ObligationRejected(cid, oid, admin);
        vm.prank(admin);
        ch.rejectObligation(oid);
    }

    function test_EmitObligationCancelled() public {
        uint256 oid = _propose(cid, bob, admin, 3e6);
        _exp();
        emit ClearingHouse.ObligationCancelled(cid, oid, bob);
        vm.prank(bob);
        ch.cancelObligation(oid);
    }

    function test_EmitCirclePaused() public {
        _exp();
        emit ClearingHouse.CirclePaused(cid, true);
        vm.prank(admin);
        ch.setPaused(cid, true);
        _exp();
        emit ClearingHouse.CirclePaused(cid, false);
        vm.prank(admin);
        ch.setPaused(cid, false);
    }

    function test_EmitNetSettledAndCycleClosedForRing() public {
        _fund(cid, admin, 100e6);
        _fund(cid, bob, 100e6);
        _fund(cid, carol, 100e6);
        _proposeAccept(cid, bob, admin, 100e6);
        _proposeAccept(cid, carol, bob, 90e6);
        _proposeAccept(cid, admin, carol, 80e6);
        vm.warp(_endOfCycle());
        // members order: admin, bob, carol; one NetSettled each, then CycleClosed
        _exp();
        emit ClearingHouse.NetSettled(cid, 1, admin, -20e6);
        _exp();
        emit ClearingHouse.NetSettled(cid, 1, bob, 10e6);
        _exp();
        emit ClearingHouse.NetSettled(cid, 1, carol, 10e6);
        _exp();
        emit ClearingHouse.CycleClosed(cid, 1, 270e6, 20e6, 3, start + CYCLE);
        ch.closeCycle(cid);
    }

    function test_EmitCycleClosedForEmptyCycleWithoutNetSettled() public {
        vm.warp(_endOfCycle());
        _exp();
        emit ClearingHouse.CycleClosed(cid, 1, 0, 0, 0, start + CYCLE);
        vm.recordLogs();
        ch.closeCycle(cid);
        // only the single CycleClosed log (recording started after the expected emit)
        assertEq(vm.getRecordedLogs().length, 1);
    }

    function test_NoNetSettledForZeroNetMember() public {
        // balanced ring -> everyone nets to zero -> no NetSettled events, only CycleClosed
        _fund(cid, admin, 100e6);
        _proposeAccept(cid, bob, admin, 100e6);
        _proposeAccept(cid, carol, bob, 100e6);
        _proposeAccept(cid, admin, carol, 100e6);
        vm.warp(_endOfCycle());
        vm.recordLogs();
        ch.closeCycle(cid);
        assertEq(vm.getRecordedLogs().length, 1);
    }

    function test_EmitMultiCycleCatchUpCycleNumbers() public {
        vm.warp(start + 2 * uint256(CYCLE));
        _exp();
        emit ClearingHouse.CycleClosed(cid, 1, 0, 0, 0, start + CYCLE);
        ch.closeCycle(cid);
        _exp();
        emit ClearingHouse.CycleClosed(cid, 2, 0, 0, 0, uint64(start + 2 * uint256(CYCLE)));
        ch.closeCycle(cid);
    }
}
