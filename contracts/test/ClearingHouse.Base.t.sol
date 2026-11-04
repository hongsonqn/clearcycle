// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ClearingHouse} from "../ClearingHouse.sol";

/// @dev 6-decimal mock USDC with open mint.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract ClearingHouseTestBase is Test {
    ClearingHouse internal ch;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave"); // outsider
    address internal eve = makeAddr("eve"); // outsider

    uint32 internal constant CYCLE = 7 days;
    uint256 internal constant T0 = 1_000_000;
    bytes32 internal constant REF = keccak256("invoice");

    uint256 internal cid; // circle with admin, bob, carol
    uint64 internal start;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        ch = new ClearingHouse(IERC20(address(usdc)));
        vm.prank(admin);
        cid = ch.createCircle("Ring", CYCLE);
        start = uint64(T0);
        _join(cid, bob);
        _join(cid, carol);
    }

    function _join(uint256 id, address who) internal {
        address a = ch.getCircle(id).admin;
        vm.prank(a);
        ch.inviteMember(id, who);
        vm.prank(who);
        ch.join(id);
    }

    function _fund(uint256 id, address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(ch), amt);
        ch.deposit(id, amt);
        vm.stopPrank();
    }

    /// @dev payee proposes an invoice to payer.
    function _propose(uint256 id, address payee, address payer, uint128 amt) internal returns (uint256 oid) {
        vm.prank(payee);
        oid = ch.proposeObligation(id, payer, amt, REF);
    }

    function _accept(address payer, uint256 oid) internal {
        vm.prank(payer);
        ch.acceptObligation(oid);
    }

    function _proposeAccept(uint256 id, address payee, address payer, uint128 amt) internal returns (uint256 oid) {
        oid = _propose(id, payee, payer, amt);
        _accept(payer, oid);
    }

    function _pause(uint256 id, bool p) internal {
        vm.prank(ch.getCircle(id).admin);
        ch.setPaused(id, p);
    }

    function _endOfCycle() internal view returns (uint256) {
        return ch.cycleEndsAt(cid);
    }

    function _sumNets(uint256 id) internal view returns (int256 s) {
        address[] memory ms = ch.getMembers(id);
        for (uint256 i; i < ms.length; ++i) {
            s += ch.netPositionOf(id, ms[i]);
        }
    }

    function _sumBalances(uint256 id) internal view returns (uint256 s) {
        address[] memory ms = ch.getMembers(id);
        for (uint256 i; i < ms.length; ++i) {
            s += ch.balanceOf(id, ms[i]);
        }
    }
}
