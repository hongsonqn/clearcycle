// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ClearingHouseTestBase} from "./ClearingHouse.Base.t.sol";
import {ClearingHouse} from "../ClearingHouse.sol";

contract ClearingHousePausedTest is ClearingHouseTestBase {
    // ---- blocked while paused ----
    function test_PausedBlocksDeposit() public {
        usdc.mint(bob, 1e6);
        vm.prank(bob);
        usdc.approve(address(ch), 1e6);
        _pause(cid, true);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.CircleIsPaused.selector);
        ch.deposit(cid, 1e6);
    }

    function test_PausedBlocksPropose() public {
        _pause(cid, true);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.CircleIsPaused.selector);
        ch.proposeObligation(cid, admin, 1e6, REF);
    }

    function test_PausedBlocksAccept() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _propose(cid, bob, admin, 5e6);
        _pause(cid, true);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.CircleIsPaused.selector);
        ch.acceptObligation(oid);
    }

    // ---- still working while paused ----
    function test_PausedAllowsWithdraw() public {
        _fund(cid, bob, 10e6);
        _pause(cid, true);
        vm.prank(bob);
        ch.withdraw(cid, 10e6, bob);
        assertEq(usdc.balanceOf(bob), 10e6);
    }

    function test_PausedAllowsCloseCycleAndSettles() public {
        _fund(cid, admin, 10e6);
        _proposeAccept(cid, bob, admin, 10e6);
        _pause(cid, true);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        assertEq(ch.balanceOf(cid, bob), 10e6);
        assertEq(ch.balanceOf(cid, admin), 0);
    }

    function test_PausedAllowsRejectAndCancel() public {
        uint256 o1 = _propose(cid, bob, admin, 1e6);
        uint256 o2 = _propose(cid, bob, admin, 2e6);
        _pause(cid, true);
        vm.prank(admin);
        ch.rejectObligation(o1);
        vm.prank(bob);
        ch.cancelObligation(o2);
        assertEq(uint8(ch.getObligation(o1).status), uint8(ClearingHouse.Status.Rejected));
        assertEq(uint8(ch.getObligation(o2).status), uint8(ClearingHouse.Status.Cancelled));
    }

    function test_PausedAllowsMembershipAndPolicy() public {
        _pause(cid, true);
        vm.prank(admin);
        ch.inviteMember(cid, dave);
        vm.prank(dave);
        ch.join(cid);
        vm.prank(bob);
        ch.setPolicy(cid, carol, 1, 1);
        vm.prank(bob);
        ch.leave(cid);
        assertFalse(ch.isMember(cid, bob));
    }

    function test_UnpauseRestoresOperations() public {
        _pause(cid, true);
        _pause(cid, false);
        _fund(cid, admin, 10e6);
        _proposeAccept(cid, bob, admin, 5e6);
        assertEq(ch.netPositionOf(cid, bob), 5e6);
    }

    function test_PauseIsPerCircle() public {
        vm.prank(bob);
        uint256 id2 = ch.createCircle("Other", 1 days);
        _pause(cid, true);
        _fund(id2, bob, 1e6); // other circle unaffected
        assertEq(ch.balanceOf(id2, bob), 1e6);
        assertFalse(ch.getCircle(id2).paused);
        assertTrue(ch.getCircle(cid).paused);
    }

    function test_PausedStopsAutoAcceptBecauseProposeReverts() public {
        _fund(cid, admin, 10e6);
        vm.prank(admin);
        ch.setPolicy(cid, bob, 10e6, 10e6);
        _pause(cid, true);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.CircleIsPaused.selector);
        ch.proposeObligation(cid, admin, 1e6, REF);
    }

    function test_PausedStaleObligationCanStillBeRejected() public {
        uint256 oid = _propose(cid, bob, admin, 1e6);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        _pause(cid, true);
        vm.prank(admin);
        ch.rejectObligation(oid);
    }
}
