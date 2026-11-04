// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClearingHouse} from "../ClearingHouse.sol";
import {MockUSDC} from "./ClearingHouse.Base.t.sol";

/// @dev Drives bounded random actions across two circles and five actors.
contract ClearingHouseHandler is Test {
    ClearingHouse public ch;
    MockUSDC public usdc;

    address[] public actors;
    uint256[] public circles;
    uint256[] public obligationIds;

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public closes;
    uint256 public autoAccepts;
    uint256 public explicitAccepts;

    constructor(ClearingHouse _ch, MockUSDC _usdc) {
        ch = _ch;
        usdc = _usdc;
        for (uint256 i; i < 5; ++i) {
            actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        for (uint256 c; c < 2; ++c) {
            address a = actors[c]; // actor0 admins circle 1, actor1 admins circle 2
            vm.prank(a);
            circles.push(_ch.createCircle("c", 1 days));
        }
        // seed memberships so that interesting activity happens from the start
        for (uint256 c; c < 2; ++c) {
            for (uint256 i; i < 5; ++i) {
                if (actors[i] == actors[c]) continue;
                vm.prank(actors[c]);
                _ch.inviteMember(circles[c], actors[i]);
                vm.prank(actors[i]);
                _ch.join(circles[c]);
            }
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function circleCount() external view returns (uint256) {
        return circles.length;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _c(uint256 s) internal view returns (uint256) {
        return circles[s % circles.length];
    }

    function deposit(uint256 aS, uint256 cS, uint256 amt) external {
        address a = _a(aS);
        uint256 c = _c(cS);
        amt = bound(amt, 1, 1_000e6);
        usdc.mint(a, amt);
        vm.startPrank(a);
        usdc.approve(address(ch), amt);
        try ch.deposit(c, amt) {
            ghostDeposited += amt;
        } catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 aS, uint256 cS, uint256 amt, uint256 toS) external {
        address a = _a(aS);
        uint256 c = _c(cS);
        uint256 max = ch.withdrawableOf(c, a);
        if (max == 0) return;
        amt = bound(amt, 1, max);
        vm.prank(a);
        try ch.withdraw(c, amt, _a(toS)) {
            ghostWithdrawn += amt;
        } catch {}
    }

    function propose(uint256 payeeS, uint256 payerS, uint256 cS, uint256 amt) external {
        address payee = _a(payeeS);
        address payer = _a(payerS);
        uint256 c = _c(cS);
        amt = bound(amt, 1, 500e6);
        vm.prank(payee);
        try ch.proposeObligation(c, payer, uint128(amt), bytes32(amt)) returns (uint256 id) {
            obligationIds.push(id);
            if (ch.getObligation(id).status == ClearingHouse.Status.Accepted) autoAccepts++;
        } catch {}
    }

    function accept(uint256 idS) external {
        if (obligationIds.length == 0) return;
        uint256 id = obligationIds[idS % obligationIds.length];
        address payer = ch.getObligation(id).payer;
        vm.prank(payer);
        try ch.acceptObligation(id) {
            explicitAccepts++;
        } catch {}
    }

    function reject(uint256 idS) external {
        if (obligationIds.length == 0) return;
        uint256 id = obligationIds[idS % obligationIds.length];
        vm.prank(ch.getObligation(id).payer);
        try ch.rejectObligation(id) {} catch {}
    }

    function cancel(uint256 idS) external {
        if (obligationIds.length == 0) return;
        uint256 id = obligationIds[idS % obligationIds.length];
        vm.prank(ch.getObligation(id).payee);
        try ch.cancelObligation(id) {} catch {}
    }

    function setPolicy(uint256 payerS, uint256 payeeS, uint256 cS, uint128 perObl, uint128 perCycle) external {
        perObl = uint128(bound(perObl, 0, 400e6));
        perCycle = uint128(bound(perCycle, 0, 1_000e6));
        vm.prank(_a(payerS));
        try ch.setPolicy(_c(cS), _a(payeeS), perObl, perCycle) {} catch {}
    }

    function setPaused(uint256 cS, uint256 p) external {
        uint256 c = _c(cS);
        vm.prank(ch.getCircle(c).admin);
        ch.setPaused(c, p % 5 == 0); // paused ~20% of the time
    }

    function leave(uint256 aS, uint256 cS) external {
        vm.prank(_a(aS));
        try ch.leave(_c(cS)) {} catch {}
    }

    function rejoin(uint256 aS, uint256 cS) external {
        address a = _a(aS);
        uint256 c = _c(cS);
        if (ch.isMember(c, a)) return;
        vm.prank(ch.getCircle(c).admin);
        ch.inviteMember(c, a);
        vm.prank(a);
        ch.join(c);
    }

    function closeCycle(uint256 cS, uint256 extra) external {
        if (extra % 6 != 0) return; // close only ~1/6 of the time so cycles hold activity
        uint256 c = _c(cS);
        uint256 end = ch.cycleEndsAt(c);
        if (block.timestamp < end) vm.warp(end + bound(extra, 0, 1 days));
        ch.closeCycle(c);
        closes++;
    }
}

contract ClearingHouseInvariantTest is Test {
    ClearingHouse internal ch;
    MockUSDC internal usdc;
    ClearingHouseHandler internal h;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        ch = new ClearingHouse(IERC20(address(usdc)));
        h = new ClearingHouseHandler(ch, usdc);
        targetContract(address(h));
    }

    function afterInvariant() public view {
        console2.log("closes", h.closes());
        console2.log("autoAccepts", h.autoAccepts());
        console2.log("explicitAccepts", h.explicitAccepts());
        console2.log("deposited", h.ghostDeposited());
        console2.log("withdrawn", h.ghostWithdrawn());
    }

    /// @dev Sum of nets per circle is zero (including all actors, member or not).
    function invariant_SumOfNetsIsZeroPerCircle() public view {
        for (uint256 c; c < h.circleCount(); ++c) {
            uint256 id = h.circles(c);
            int256 s;
            for (uint256 i; i < h.actorCount(); ++i) {
                s += ch.netPositionOf(id, h.actors(i));
            }
            assertEq(s, 0, "sum of nets");
        }
    }

    /// @dev Coverage: balance + net >= 0 for everyone.
    function invariant_CoverageNonNegative() public view {
        for (uint256 c; c < h.circleCount(); ++c) {
            uint256 id = h.circles(c);
            for (uint256 i; i < h.actorCount(); ++i) {
                address a = h.actors(i);
                assertGe(int256(ch.balanceOf(id, a)) + ch.netPositionOf(id, a), 0, "coverage");
            }
        }
    }

    /// @dev Custody: token balance covers all recorded balances.
    function invariant_TokenBalanceCoversTotalBalances() public view {
        assertGe(usdc.balanceOf(address(ch)), ch.totalBalances());
    }

    /// @dev totalBalances equals the sum of member balances across circles.
    function invariant_TotalBalancesEqualsSumOfMemberBalances() public view {
        uint256 sum;
        for (uint256 c; c < h.circleCount(); ++c) {
            uint256 id = h.circles(c);
            for (uint256 i; i < h.actorCount(); ++i) {
                sum += ch.balanceOf(id, h.actors(i));
            }
        }
        assertEq(ch.totalBalances(), sum, "totalBalances");
    }

    /// @dev Ghost conservation: deposits - withdrawals == totalBalances == token balance (no unsolicited tokens).
    function invariant_GhostConservation() public view {
        assertEq(h.ghostDeposited() - h.ghostWithdrawn(), ch.totalBalances());
        assertEq(usdc.balanceOf(address(ch)), ch.totalBalances());
    }

    /// @dev Members with a position are always still members (leave requires zero position).
    function invariant_NonMembersHaveNoPosition() public view {
        for (uint256 c; c < h.circleCount(); ++c) {
            uint256 id = h.circles(c);
            for (uint256 i; i < h.actorCount(); ++i) {
                address a = h.actors(i);
                if (!ch.isMember(id, a)) {
                    assertEq(ch.balanceOf(id, a), 0);
                    assertEq(ch.netPositionOf(id, a), 0);
                }
            }
        }
    }
}
