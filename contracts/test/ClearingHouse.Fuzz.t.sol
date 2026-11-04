// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ClearingHouseTestBase} from "./ClearingHouse.Base.t.sol";
import {ClearingHouse} from "../ClearingHouse.sol";

contract ClearingHouseFuzzTest is ClearingHouseTestBase {
    uint256 internal constant MAXAMT = 1e30;

    function testFuzz_DepositCreditsExactAmount(uint256 amount) public {
        amount = bound(amount, 1, MAXAMT);
        _fund(cid, bob, amount);
        assertEq(ch.balanceOf(cid, bob), amount);
        assertEq(ch.totalBalances(), amount);
        assertEq(usdc.balanceOf(address(ch)), amount);
    }

    function testFuzz_DepositThenWithdrawRoundTrip(uint256 amount, uint256 w, address to) public {
        vm.assume(to != address(0) && to != address(ch));
        amount = bound(amount, 1, MAXAMT);
        w = bound(w, 1, amount);
        _fund(cid, bob, amount);
        uint256 before = usdc.balanceOf(to);
        vm.prank(bob);
        ch.withdraw(cid, w, to);
        assertEq(usdc.balanceOf(to), before + w);
        assertEq(ch.balanceOf(cid, bob), amount - w);
        assertEq(ch.totalBalances(), amount - w);
        assertEq(usdc.balanceOf(address(ch)), amount - w);
    }

    function testFuzz_WithdrawAboveBalanceReverts(uint256 amount, uint256 extra) public {
        amount = bound(amount, 1, MAXAMT);
        extra = bound(extra, 1, MAXAMT);
        _fund(cid, bob, amount);
        vm.prank(bob);
        vm.expectRevert(ClearingHouse.InsufficientBalance.selector);
        ch.withdraw(cid, amount + extra, bob);
    }

    function testFuzz_ProposeAcceptWithinCoverage(uint256 dep, uint128 amt) public {
        dep = bound(dep, 1, MAXAMT);
        amt = uint128(bound(amt, 1, dep));
        _fund(cid, admin, dep);
        uint256 oid = _proposeAccept(cid, bob, admin, amt);
        assertEq(ch.netPositionOf(cid, admin), -int256(uint256(amt)));
        assertEq(ch.netPositionOf(cid, bob), int256(uint256(amt)));
        assertEq(ch.withdrawableOf(cid, admin), dep - amt);
        assertEq(_sumNets(cid), 0);
        assertEq(uint8(ch.getObligation(oid).status), uint8(ClearingHouse.Status.Accepted));
    }

    function testFuzz_ProposeAboveCoverageCannotBeAccepted(uint256 dep, uint128 over) public {
        dep = bound(dep, 0, MAXAMT);
        over = uint128(bound(over, 1, MAXAMT));
        if (dep > 0) _fund(cid, admin, dep);
        uint128 amt = uint128(dep) + over;
        uint256 oid = _propose(cid, bob, admin, amt); // proposing is always allowed
        vm.prank(admin);
        vm.expectRevert(ClearingHouse.InsufficientCoverage.selector);
        ch.acceptObligation(oid);
    }

    function testFuzz_WithdrawRespectsOpenDebit(uint256 dep, uint128 amt, uint256 w) public {
        dep = bound(dep, 1, MAXAMT);
        amt = uint128(bound(amt, 1, dep));
        _fund(cid, admin, dep);
        _proposeAccept(cid, bob, admin, amt);
        uint256 free = dep - amt;
        w = bound(w, 1, dep);
        vm.prank(admin);
        if (w > free) {
            vm.expectRevert(ClearingHouse.InsufficientCoverage.selector);
            ch.withdraw(cid, w, admin);
        } else {
            ch.withdraw(cid, w, admin);
            assertEq(ch.balanceOf(cid, admin), dep - w);
        }
    }

    function testFuzz_ClosePreservesTotalAndSettlesNets(uint256 dep, uint128 amt) public {
        dep = bound(dep, 1, MAXAMT);
        amt = uint128(bound(amt, 1, dep));
        _fund(cid, admin, dep);
        _proposeAccept(cid, bob, admin, amt);
        vm.warp(_endOfCycle());
        _exp(amt);
        ch.closeCycle(cid);
        assertEq(ch.balanceOf(cid, admin), dep - amt);
        assertEq(ch.balanceOf(cid, bob), amt);
        assertEq(_sumBalances(cid), dep);
        assertEq(ch.totalBalances(), dep);
        assertEq(_sumNets(cid), 0);
    }

    function _exp(uint128 amt) internal {
        vm.expectEmit(true, true, true, true, address(ch));
        emit ClearingHouse.NetSettled(cid, 1, admin, -int256(uint256(amt)));
        vm.expectEmit(true, true, true, true, address(ch));
        emit ClearingHouse.NetSettled(cid, 1, bob, int256(uint256(amt)));
    }

    function testFuzz_RingNetVolumeNeverExceedsGross(uint128 a, uint128 b, uint128 c) public {
        a = uint128(bound(a, 1, 1e24));
        b = uint128(bound(b, 1, 1e24));
        c = uint128(bound(c, 1, 1e24));
        // admin owes bob a, bob owes carol b, carol owes admin c
        _fund(cid, admin, a);
        _fund(cid, bob, b);
        _fund(cid, carol, c);
        _proposeAccept(cid, bob, admin, a);
        _proposeAccept(cid, carol, bob, b);
        _proposeAccept(cid, admin, carol, c);

        int256 nA = int256(uint256(c)) - int256(uint256(a));
        int256 nB = int256(uint256(a)) - int256(uint256(b));
        int256 nC = int256(uint256(b)) - int256(uint256(c));
        assertEq(ch.netPositionOf(cid, admin), nA);
        assertEq(ch.netPositionOf(cid, bob), nB);
        assertEq(ch.netPositionOf(cid, carol), nC);
        assertEq(nA + nB + nC, 0);

        uint256 netVol;
        if (nA > 0) netVol += uint256(nA);
        if (nB > 0) netVol += uint256(nB);
        if (nC > 0) netVol += uint256(nC);
        uint256 gross = uint256(a) + b + c;
        assertLe(netVol, gross);

        vm.warp(_endOfCycle());
        vm.expectEmit(true, true, false, true, address(ch));
        emit ClearingHouse.CycleClosed(cid, 1, gross, netVol, 3, start + CYCLE);
        ch.closeCycle(cid);

        assertEq(ch.balanceOf(cid, admin), uint256(int256(uint256(a)) + nA));
        assertEq(ch.balanceOf(cid, bob), uint256(int256(uint256(b)) + nB));
        assertEq(ch.balanceOf(cid, carol), uint256(int256(uint256(c)) + nC));
        assertEq(ch.totalBalances(), uint256(a) + b + c);
    }

    function testFuzz_AutoAcceptRespectsLimits(uint128 perObl, uint128 perCycle, uint128 amt) public {
        perObl = uint128(bound(perObl, 1, 1e24));
        perCycle = uint128(bound(perCycle, 1, 1e24));
        amt = uint128(bound(amt, 1, 1e24));
        _fund(cid, admin, 1e25);
        vm.prank(admin);
        ch.setPolicy(cid, bob, perObl, perCycle);
        uint256 oid = _propose(cid, bob, admin, amt);
        bool expectAuto = amt <= perObl && amt <= perCycle;
        assertEq(
            uint8(ch.getObligation(oid).status),
            expectAuto ? uint8(ClearingHouse.Status.Accepted) : uint8(ClearingHouse.Status.Proposed)
        );
        assertEq(ch.autoUsedOf(cid, 1, admin, bob), expectAuto ? amt : 0);
    }
}
