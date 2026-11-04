// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ClearingHouseTestBase} from "./ClearingHouse.Base.t.sol";
import {ClearingHouse} from "../ClearingHouse.sol";

/// @dev Invoicing belongs to the calendar interval: once it elapses, closeCycle must run first.
contract ClearingHouseOverdueTest is ClearingHouseTestBase {
    function test_ProposeRevertsAtExactDeadline() public {
        _fund(cid, bob, 100e6);
        vm.warp(_endOfCycle());
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.CycleOverdue.selector);
        ch.proposeObligation(cid, bob, 10e6, REF);
    }

    function test_ProposeWorksOneSecondBeforeDeadline() public {
        _fund(cid, bob, 100e6);
        vm.warp(_endOfCycle() - 1);
        uint256 id = _proposeAccept(cid, admin, bob, 10e6);
        assertEq(uint8(ch.getObligation(id).status), uint8(ClearingHouse.Status.Accepted));
    }

    function test_AcceptRevertsAfterDeadlineThenWorksNextCycle() public {
        _fund(cid, bob, 100e6);
        uint256 id = _propose(cid, admin, bob, 10e6);
        vm.warp(_endOfCycle());
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.CycleOverdue.selector);
        ch.acceptObligation(id);

        ch.closeCycle(cid);
        // Proposal is now stale and cannot be accepted retroactively.
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.StaleObligation.selector);
        ch.acceptObligation(id);
        assertTrue(ch.isExpired(id));
    }

    function test_AutoAllowanceCannotBeReusedAcrossElapsedCycles() public {
        _fund(cid, bob, 1000e6);
        vm.prank(bob);
        ch.setPolicy(cid, admin, 100e6, 100e6);
        vm.warp(_endOfCycle() + 3 * uint256(CYCLE));
        // Four cycles have elapsed without anybody closing: invoicing is blocked until caught up.
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.CycleOverdue.selector);
        ch.proposeObligation(cid, bob, 100e6, REF);
    }

    function test_WithdrawAndCloseStillWorkWhenOverdue() public {
        _fund(cid, bob, 100e6);
        vm.warp(_endOfCycle());
        vm.prank(bob);
        ch.withdraw(cid, 40e6, bob);
        ch.closeCycle(cid);
        assertEq(ch.balanceOf(cid, bob), 60e6);
    }
}
