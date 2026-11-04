// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ClearingHouseTestBase, MockUSDC} from "./ClearingHouse.Base.t.sol";
import {ClearingHouse} from "../ClearingHouse.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract ClearingHouseRevertTest is ClearingHouseTestBase {
    // ---------- constructor / createCircle ----------
    function test_RevertConstructorZeroToken() public {
        vm.expectRevert(ClearingHouse.ZeroAddress.selector);
        new ClearingHouse(IERC20(address(0)));
    }

    function test_RevertCreateCircleDurationTooShort() public {
        vm.expectRevert(ClearingHouse.InvalidCycleDuration.selector);
        ch.createCircle("x", 1 hours - 1);
    }

    function test_RevertCreateCircleDurationTooLong() public {
        vm.expectRevert(ClearingHouse.InvalidCycleDuration.selector);
        ch.createCircle("x", uint32(90 days + 1));
    }

    // ---------- admin / invitations ----------
    function test_RevertInviteNotAdmin() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotAdmin.selector);
        ch.inviteMember(cid, dave);
    }

    function test_RevertInviteZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.ZeroAddress.selector);
        ch.inviteMember(cid, address(0));
    }

    function test_RevertInviteAlreadyMember() public {
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.AlreadyMember.selector);
        ch.inviteMember(cid, bob);
    }

    function test_RevertInviteUnknownCircle() public {
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.inviteMember(999, dave);
    }

    function test_RevertRevokeInviteNotAdmin() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotAdmin.selector);
        ch.revokeInvite(cid, dave);
    }

    function test_RevertSetPausedNotAdmin() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotAdmin.selector);
        ch.setPaused(cid, true);
    }

    function test_RevertJoinNotInvited() public {
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotInvited.selector);
        ch.join(cid);
    }

    function test_RevertJoinUnknownCircle() public {
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.join(999);
    }

    function test_RevertJoinTwiceBecauseInviteConsumed() public {
        vm.prank(admin);
        ch.inviteMember(cid, dave);
        vm.prank(dave);
        ch.join(cid);
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotInvited.selector);
        ch.join(cid);
    }

    function test_MaxMembersEnforced() public {
        assertEq(ch.getMembers(cid).length, 3);
        // fill to MAX_MEMBERS (32)
        for (uint256 i; i < 29; ++i) {
            _join(cid, address(uint160(0x1000 + i)));
        }
        assertEq(ch.getMembers(cid).length, 32);

        vm.prank(admin);
        ch.inviteMember(cid, dave); // invitation itself is not capped
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.MemberLimitReached.selector);
        ch.join(cid);

        // a slot frees up -> dave can join
        vm.prank(address(uint160(0x1000)));
        ch.leave(cid);
        vm.prank(dave);
        ch.join(cid);
        assertEq(ch.getMembers(cid).length, 32);
    }

    // ---------- leave ----------
    function test_RevertLeaveNonMember() public {
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.leave(cid);
    }

    function test_RevertAdminCannotLeave() public {
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.AdminCannotLeave.selector);
        ch.leave(cid);
    }

    function test_RevertLeaveWithBalance() public {
        _fund(cid, bob, 1);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.OutstandingPosition.selector);
        ch.leave(cid);
    }

    function test_RevertLeaveWithOpenNetCredit() public {
        _fund(cid, admin, 10e6);
        _proposeAccept(cid, bob, admin, 10e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.OutstandingPosition.selector);
        ch.leave(cid);
    }

    function test_RevertLeaveWithOpenNetDebit() public {
        _fund(cid, admin, 10e6);
        _proposeAccept(cid, bob, admin, 10e6);
        // admin can't leave anyway; use carol as payer in a fresh scenario
        _fund(cid, carol, 10e6);
        _proposeAccept(cid, bob, carol, 10e6);
        vm.prank(carol);
        vm.expectRevert(ClearingHouse.OutstandingPosition.selector);
        ch.leave(cid);
    }

    function test_RevertLeaveUnknownCircle() public {
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.leave(42);
    }

    // ---------- deposit ----------
    function test_RevertDepositNonMember() public {
        usdc.mint(dave, 1e6);
        vm.startPrank(dave);
        usdc.approve(address(ch), 1e6);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.deposit(cid, 1e6);
        vm.stopPrank();
    }

    function test_RevertDepositZero() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.ZeroAmount.selector);
        ch.deposit(cid, 0);
    }

    function test_RevertDepositUnknownCircle() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.deposit(77, 1);
    }

    function test_RevertDepositWithoutAllowance() public {
        usdc.mint(bob, 1e6);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(ch), 0, 1e6)
        );
        ch.deposit(cid, 1e6);
    }

    function test_RevertDepositWithoutFunds() public {
        vm.startPrank(bob);
        usdc.approve(address(ch), 1e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, bob, 0, 1e6));
        ch.deposit(cid, 1e6);
        vm.stopPrank();
    }

    function test_RevertDepositCapacityExceeded() public {
        uint256 maxI = uint256(type(int256).max);
        usdc.mint(bob, maxI + 1);
        vm.startPrank(bob);
        usdc.approve(address(ch), type(uint256).max);
        ch.deposit(cid, maxI);
        vm.expectRevert(ClearingHouse.CapacityExceeded.selector);
        ch.deposit(cid, 1);
        vm.stopPrank();
    }

    // ---------- withdraw ----------
    function test_RevertWithdrawNonMember() public {
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.withdraw(cid, 1, dave);
    }

    function test_RevertWithdrawZeroAddress() public {
        _fund(cid, bob, 1e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.ZeroAddress.selector);
        ch.withdraw(cid, 1, address(0));
    }

    function test_RevertWithdrawZeroAmount() public {
        _fund(cid, bob, 1e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.ZeroAmount.selector);
        ch.withdraw(cid, 0, bob);
    }

    function test_RevertWithdrawInsufficientBalance() public {
        _fund(cid, bob, 1e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.InsufficientBalance.selector);
        ch.withdraw(cid, 1e6 + 1, bob);
    }

    function test_RevertWithdrawInsufficientCoverage() public {
        _fund(cid, bob, 100e6);
        _proposeAccept(cid, carol, bob, 100e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.InsufficientCoverage.selector);
        ch.withdraw(cid, 1, bob);
    }

    // ---------- policy ----------
    function test_RevertSetPolicyCallerNotMember() public {
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.setPolicy(cid, bob, 1, 1);
    }

    function test_RevertSetPolicyPayeeNotMember() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.setPolicy(cid, dave, 1, 1);
    }

    function test_RevertSetPolicySelf() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.SameParticipant.selector);
        ch.setPolicy(cid, bob, 1, 1);
    }

    // ---------- propose ----------
    function test_RevertProposeCallerNotMember() public {
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.proposeObligation(cid, bob, 1, REF);
    }

    function test_RevertProposePayerNotMember() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.proposeObligation(cid, dave, 1, REF);
    }

    function test_RevertProposePayerZeroAddress() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.proposeObligation(cid, address(0), 1, REF);
    }

    function test_RevertProposeSelf() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.SameParticipant.selector);
        ch.proposeObligation(cid, bob, 1, REF);
    }

    function test_RevertProposeZeroAmount() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.ZeroAmount.selector);
        ch.proposeObligation(cid, admin, 0, REF);
    }

    function test_RevertProposeUnknownCircle() public {
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.proposeObligation(55, admin, 1, REF);
    }

    function test_RevertProposeAfterPayerLeft() public {
        vm.prank(carol);
        ch.leave(cid);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.proposeObligation(cid, carol, 1, REF);
    }

    // ---------- accept / reject / cancel ----------
    function test_RevertAcceptUnknownObligation() public {
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.UnknownObligation.selector);
        ch.acceptObligation(1);
    }

    function test_RevertAcceptNotPayer() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _propose(cid, bob, admin, 10e6);
        vm.prank(bob); // payee tries to accept own invoice
        vm.expectRevert(ClearingHouse.NotPayer.selector);
        ch.acceptObligation(oid);
        vm.prank(dave);
        vm.expectRevert(ClearingHouse.NotPayer.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptTwice() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _proposeAccept(cid, bob, admin, 5e6);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.NotProposed.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptAfterReject() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _propose(cid, bob, admin, 5e6);
        vm.prank(admin);
        ch.rejectObligation(oid);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.NotProposed.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptStale() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _propose(cid, bob, admin, 5e6);
        vm.warp(_endOfCycle());
        ch.closeCycle(cid);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.StaleObligation.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptInsufficientCoverage() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _propose(cid, bob, admin, 10e6 + 1);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.InsufficientCoverage.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptCoverageConsumedByEarlierAcceptance() public {
        _fund(cid, admin, 10e6);
        uint256 o1 = _propose(cid, bob, admin, 6e6);
        uint256 o2 = _propose(cid, carol, admin, 6e6);
        _accept(admin, o1);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.InsufficientCoverage.selector);
        ch.acceptObligation(o2);
    }

    function test_RevertAcceptWhenPayeeLeft() public {
        _fund(cid, admin, 10e6);
        uint256 oid = _propose(cid, bob, admin, 5e6);
        vm.prank(bob);
        ch.leave(cid);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptWhenPayerLeft() public {
        uint256 oid = _propose(cid, bob, carol, 5e6);
        vm.prank(carol);
        ch.leave(cid);
        vm.prank(carol);
        vm.expectRevert(ClearingHouse.NotMember.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertAcceptGrossCapacityExceeded() public {
        uint256 big = uint256(type(uint128).max);
        _fund(cid, admin, big + 1);
        _proposeAccept(cid, bob, admin, type(uint128).max);
        uint256 oid = _propose(cid, bob, admin, 1);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.CapacityExceeded.selector);
        ch.acceptObligation(oid);
    }

    function test_RevertRejectUnknown() public {
        vm.expectRevert(ClearingHouse.UnknownObligation.selector);
        ch.rejectObligation(3);
    }

    function test_RevertRejectNotPayer() public {
        uint256 oid = _propose(cid, bob, admin, 5e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotPayer.selector);
        ch.rejectObligation(oid);
    }

    function test_RevertRejectNotProposed() public {
        uint256 oid = _propose(cid, bob, admin, 5e6);
        vm.prank(bob);
        ch.cancelObligation(oid);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.NotProposed.selector);
        ch.rejectObligation(oid);
    }

    function test_RevertCancelUnknown() public {
        vm.expectRevert(ClearingHouse.UnknownObligation.selector);
        ch.cancelObligation(3);
    }

    function test_RevertCancelNotPayee() public {
        uint256 oid = _propose(cid, bob, admin, 5e6);
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.NotPayee.selector);
        ch.cancelObligation(oid);
    }

    function test_RevertCancelAcceptedObligation() public {
        _fund(cid, admin, 5e6);
        uint256 oid = _proposeAccept(cid, bob, admin, 5e6);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.NotProposed.selector);
        ch.cancelObligation(oid);
    }

    // ---------- closeCycle / views ----------
    function test_RevertCloseCycleNotEnded() public {
        vm.expectRevert(ClearingHouse.CycleNotEnded.selector);
        ch.closeCycle(cid);
        vm.warp(_endOfCycle() - 1);
        vm.expectRevert(ClearingHouse.CycleNotEnded.selector);
        ch.closeCycle(cid);
    }

    function test_RevertCloseCycleUnknownCircle() public {
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.closeCycle(9);
    }

    function test_RevertViewsOnUnknownIds() public {
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.getCircle(9);
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.getMembers(9);
        vm.expectRevert(ClearingHouse.UnknownCircle.selector);
        ch.cycleEndsAt(9);
        vm.expectRevert(ClearingHouse.UnknownObligation.selector);
        ch.getObligation(9);
        vm.expectRevert(ClearingHouse.UnknownObligation.selector);
        ch.isExpired(9);
    }
}
