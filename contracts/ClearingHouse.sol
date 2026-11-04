// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Clearcycle Clearing House
 * @notice Multilateral netting of B2B payables across independent USDC circles.
 * @dev Payees propose invoices; payers accept explicitly or through pairwise policies.
 * Acceptance moves only open-cycle net positions. Closing crystallizes those positions
 * into withdrawable collateral without transferring tokens between participants.
 *
 * Coverage invariant: for every member, int256(balance) + net >= 0, and the sum
 * of each circle's nets is zero. Consequently closing never needs additional funds.
 * Custody invariant: usdc.balanceOf(address(this)) >= sum of all recorded balances.
 * totalBalances tracks that sum between calls and is bounded by int256.max, keeping
 * signed coverage arithmetic representable. Settlement uses checked arithmetic.
 *
 * The supplied token is trusted, non-rebasing USDC (six decimals); on Arc its ERC-20
 * address is 0x3600000000000000000000000000000000000000. The constructor deliberately
 * accepts an IERC20 instead of enforcing a chain-specific address. Deposits credit
 * actual receipts. Custody assumes the token cannot confiscate contract funds or
 * debit the sender by more than the requested transfer amount.
 * No owner, upgrades, protocol fees, or protocol token exist. Circle admins manage
 * invitations and pausing only. Policies survive leaving/rejoining; revoke them
 * explicitly if needed. Accepted obligations are final; reverse them with a new invoice.
 */
contract ClearingHouse is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum concurrent members of one circle.
    uint256 public constant MAX_MEMBERS = 32;
    /// @notice Minimum permitted cycle duration.
    uint256 public constant MIN_CYCLE = 1 hours;
    /// @notice Maximum permitted cycle duration.
    uint256 public constant MAX_CYCLE = 90 days;

    /// @notice Settlement token; all amounts are expressed in its base units.
    IERC20 public immutable usdc;
    /// @notice Sum of settled balances across all circles, excluding unsolicited tokens.
    uint256 public totalBalances;
    /// @notice Last allocated global circle identifier; zero is never allocated.
    uint256 public circleCount;
    /// @notice Last allocated global obligation identifier; zero is never allocated.
    uint256 public obligationCount;

    /// @notice Circle administration and open-cycle accounting.
    struct Circle {
        address admin;
        uint32 cycleDuration;
        uint64 cycleStart;
        uint64 currentCycle;
        bool paused;
        uint32 cycleObligationCount;
        uint128 cycleGross;
    }

    /// @notice Obligation lifecycle; expired proposals retain the Proposed status.
    enum Status { None, Proposed, Accepted, Rejected, Cancelled }

    /// @notice An invoice, its originating cycle, and immutable document reference.
    struct Obligation {
        address payer;
        address payee;
        uint128 amount;
        uint64 circleId;
        uint64 cycle;
        Status status;
        bytes32 ref;
    }

    /// @notice Payer authorization limits for one payee; zero limits disable automation.
    struct Policy {
        uint128 perObligationLimit;
        uint128 perCycleLimit;
    }

    mapping(uint256 => Circle) private _circles;
    mapping(uint256 => address[]) private _members;
    mapping(uint256 => mapping(address => bool)) private _isMember;
    mapping(uint256 => mapping(address => bool)) private _invited;
    // One-based indices support constant-time swap-and-pop membership removal.
    mapping(uint256 => mapping(address => uint256)) private _memberIndex;
    mapping(uint256 => mapping(address => uint256)) private _balance;
    mapping(uint256 => mapping(address => int256)) private _net;
    mapping(uint256 => Obligation) private _obligations;
    mapping(uint256 => mapping(address => mapping(address => Policy))) private _policies;
    mapping(uint256 => mapping(uint64 => mapping(address => mapping(address => uint256)))) private _autoUsed;

    /// @notice A required address was zero.
    error ZeroAddress();
    /// @notice The requested circle does not exist.
    error UnknownCircle();
    /// @notice The requested obligation does not exist.
    error UnknownObligation();
    /// @notice Only the circle administrator may perform this action.
    error NotAdmin();
    /// @notice A participant is not currently a member of the circle.
    error NotMember();
    /// @notice The invitee is already a member.
    error AlreadyMember();
    /// @notice The caller has no outstanding invitation.
    error NotInvited();
    /// @notice The circle has reached its membership limit.
    error MemberLimitReached();
    /// @notice Cycle duration lies outside the allowed interval.
    error InvalidCycleDuration();
    /// @notice The operation is disabled while the circle is paused.
    error CircleIsPaused();
    /// @notice The circle administrator cannot leave.
    error AdminCannotLeave();
    /// @notice Leaving requires both balance and net position to be zero.
    error OutstandingPosition();
    /// @notice Amount must be strictly positive.
    error ZeroAmount();
    /// @notice Payer and payee must differ.
    error SameParticipant();
    /// @notice The caller is not the obligation's payer.
    error NotPayer();
    /// @notice The caller is not the obligation's payee.
    error NotPayee();
    /// @notice The obligation is no longer Proposed.
    error NotProposed();
    /// @notice The proposal belongs to an already closed cycle.
    error StaleObligation();
    /// @notice The settled balance is insufficient for the requested withdrawal.
    error InsufficientBalance();
    /// @notice The operation would violate the member's coverage invariant.
    error InsufficientCoverage();
    /// @notice The cycle has not yet reached its calendar end.
    error CycleNotEnded();
    /// @notice The cycle's calendar end has passed; call closeCycle before further invoicing.
    error CycleOverdue();
    /// @notice A numeric identifier, timestamp, or accounting limit would be exceeded.
    error CapacityExceeded();
    /// @notice The token returned a negative deposit balance delta.
    error InvalidTokenBalanceDelta();

    /// @notice A new circle and its first member were created.
    event CircleCreated(uint256 indexed circleId, address indexed admin, string name, uint32 cycleDuration, uint64 cycleStart);
    /// @notice The administrator invited a participant.
    event MemberInvited(uint256 indexed circleId, address indexed member);
    /// @notice The administrator revoked an invitation.
    event InviteRevoked(uint256 indexed circleId, address indexed member);
    /// @notice An invited participant joined.
    event MemberJoined(uint256 indexed circleId, address indexed member);
    /// @notice A participant left with no outstanding position.
    event MemberLeft(uint256 indexed circleId, address indexed member);
    /// @notice Actual token receipts were credited to a member.
    event Deposited(uint256 indexed circleId, address indexed member, uint256 amount);
    /// @notice A member withdrew settled collateral.
    event Withdrawn(uint256 indexed circleId, address indexed member, address to, uint256 amount);
    /// @notice A payer updated a pairwise automatic-acceptance policy.
    event PolicySet(uint256 indexed circleId, address indexed payer, address indexed payee, uint128 perObligationLimit, uint128 perCycleLimit);
    /// @notice A payee proposed an invoice for the current cycle.
    event ObligationProposed(uint256 indexed circleId, uint256 indexed obligationId, address indexed payee, address payer, uint64 cycle, uint128 amount, bytes32 ref);
    /// @notice An invoice was irreversibly accepted, explicitly or automatically.
    event ObligationAccepted(uint256 indexed circleId, uint256 indexed obligationId, address indexed payer, bool automatic);
    /// @notice A payer rejected an unaccepted invoice.
    event ObligationRejected(uint256 indexed circleId, uint256 indexed obligationId, address indexed payer);
    /// @notice A payee cancelled an unaccepted invoice.
    event ObligationCancelled(uint256 indexed circleId, uint256 indexed obligationId, address indexed payee);
    /// @notice A nonzero net position was crystallized into settled balance.
    event NetSettled(uint256 indexed circleId, uint64 indexed cycle, address indexed member, int256 net);
    /// @notice A calendar cycle closed, including an empty cycle.
    event CycleClosed(uint256 indexed circleId, uint64 indexed cycle, uint256 grossVolume, uint256 netVolume, uint32 obligationCount, uint64 nextCycleStart);
    /// @notice The circle's selective pause flag changed.
    event CirclePaused(uint256 indexed circleId, bool paused);

    /// @param usdc_ Trusted USDC ERC-20 token, normally Arc's six-decimal USDC view.
    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    /// @dev Require an existing circle and its administrator.
    modifier onlyAdmin(uint256 circleId) {
        if (_circle(circleId).admin != msg.sender) revert NotAdmin();
        _;
    }

    /// @dev Require an existing circle and current caller membership.
    modifier onlyMember(uint256 circleId) {
        _circle(circleId);
        if (!_isMember[circleId][msg.sender]) revert NotMember();
        _;
    }

    /// @notice Create a circle with the caller as administrator and first member.
    /// @param name Offchain display name, recorded only in the creation event.
    /// @param cycleDuration Calendar cycle length in seconds.
    /// @return id Newly allocated global circle identifier.
    function createCircle(string calldata name, uint32 cycleDuration) external returns (uint256 id) {
        if (cycleDuration < MIN_CYCLE || cycleDuration > MAX_CYCLE) revert InvalidCycleDuration();
        if (circleCount == type(uint64).max || block.timestamp > type(uint64).max) revert CapacityExceeded();
        id = ++circleCount;
        uint64 start = uint64(block.timestamp);
        _circles[id] = Circle(msg.sender, cycleDuration, start, 1, false, 0, 0);
        _members[id].push(msg.sender);
        _isMember[id][msg.sender] = true;
        _memberIndex[id][msg.sender] = 1;
        emit CircleCreated(id, msg.sender, name, cycleDuration, start);
    }

    /// @notice Invite a nonzero nonmember; capacity is checked only when joining.
    function inviteMember(uint256 circleId, address member) external onlyAdmin(circleId) {
        if (member == address(0)) revert ZeroAddress();
        if (_isMember[circleId][member]) revert AlreadyMember();
        _invited[circleId][member] = true;
        emit MemberInvited(circleId, member);
    }

    /// @notice Revoke an invitation, whether or not it is currently outstanding.
    function revokeInvite(uint256 circleId, address member) external onlyAdmin(circleId) {
        _invited[circleId][member] = false;
        emit InviteRevoked(circleId, member);
    }

    /// @notice Pause only deposits, proposals, and acceptance; exits and closing remain available.
    function setPaused(uint256 circleId, bool paused) external onlyAdmin(circleId) {
        _circles[circleId].paused = paused;
        emit CirclePaused(circleId, paused);
    }

    /// @notice Consume the caller's invitation and join, even while paused.
    function join(uint256 circleId) external {
        _circle(circleId);
        if (!_invited[circleId][msg.sender]) revert NotInvited();
        if (_isMember[circleId][msg.sender]) revert AlreadyMember();
        if (_members[circleId].length >= MAX_MEMBERS) revert MemberLimitReached();
        _invited[circleId][msg.sender] = false;
        _isMember[circleId][msg.sender] = true;
        _members[circleId].push(msg.sender);
        _memberIndex[circleId][msg.sender] = _members[circleId].length;
        emit MemberJoined(circleId, msg.sender);
    }

    /// @notice Leave with zero collateral and zero net; administrators cannot leave.
    /// @dev Policies and proposals persist, but proposals require both parties to be members at acceptance.
    function leave(uint256 circleId) external onlyMember(circleId) {
        if (_circles[circleId].admin == msg.sender) revert AdminCannotLeave();
        if (_balance[circleId][msg.sender] != 0 || _net[circleId][msg.sender] != 0) revert OutstandingPosition();
        address[] storage members = _members[circleId];
        uint256 index = _memberIndex[circleId][msg.sender] - 1;
        uint256 lastIndex = members.length - 1;
        if (index != lastIndex) {
            address moved = members[lastIndex];
            members[index] = moved;
            _memberIndex[circleId][moved] = index + 1;
        }
        members.pop();
        delete _memberIndex[circleId][msg.sender];
        delete _isMember[circleId][msg.sender];
        emit MemberLeft(circleId, msg.sender);
    }

    /// @notice Deposit a positive token amount, crediting only the actual received delta.
    /// @dev Both token-moving entry points share a reentrancy guard.
    function deposit(uint256 circleId, uint256 amount) external nonReentrant onlyMember(circleId) {
        _requireUnpaused(_circles[circleId]);
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = usdc.balanceOf(address(this));
        if (afterBalance < beforeBalance) revert InvalidTokenBalanceDelta();
        uint256 received = afterBalance - beforeBalance;
        if (received > uint256(type(int256).max) - totalBalances) revert CapacityExceeded();
        totalBalances += received;
        _balance[circleId][msg.sender] += received;
        emit Deposited(circleId, msg.sender, received);
    }

    /// @notice Withdraw positive settled collateral without reducing coverage below zero.
    /// @param to Nonzero token recipient, which may differ from the member.
    function withdraw(uint256 circleId, uint256 amount, address to) external nonReentrant onlyMember(circleId) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 settled = _balance[circleId][msg.sender];
        if (amount > settled) revert InsufficientBalance();
        uint256 remaining = settled - amount;
        if (int256(remaining) + _net[circleId][msg.sender] < 0) revert InsufficientCoverage();
        _balance[circleId][msg.sender] = remaining;
        totalBalances -= amount;
        emit Withdrawn(circleId, msg.sender, to, amount);
        usdc.safeTransfer(to, amount);
    }

    /// @notice Set the caller's automatic-acceptance authorization for one member payee.
    /// @dev Both limits zero revoke it; changing limits never resets current-cycle usage.
    function setPolicy(uint256 circleId, address payee, uint128 perObligationLimit, uint128 perCycleLimit)
        external onlyMember(circleId)
    {
        if (!_isMember[circleId][payee]) revert NotMember();
        if (payee == msg.sender) revert SameParticipant();
        _policies[circleId][msg.sender][payee] = Policy(perObligationLimit, perCycleLimit);
        emit PolicySet(circleId, msg.sender, payee, perObligationLimit, perCycleLimit);
    }

    /// @notice Propose an invoice as its payee; qualifying payer authorization accepts it immediately.
    /// @param circleId Circle containing both parties.
    /// @param payer Member owing the invoice amount.
    /// @param amount Positive amount in USDC base units.
    /// @param ref Hash of the offchain invoice document.
    /// @return id Newly allocated global obligation identifier.
    function proposeObligation(uint256 circleId, address payer, uint128 amount, bytes32 ref)
        external onlyMember(circleId) returns (uint256 id)
    {
        Circle storage circle = _circles[circleId];
        _requireUnpaused(circle);
        _requireNotOverdue(circle);
        if (!_isMember[circleId][payer]) revert NotMember();
        if (payer == msg.sender) revert SameParticipant();
        if (amount == 0) revert ZeroAmount();
        id = ++obligationCount;
        _obligations[id] = Obligation(payer, msg.sender, amount, uint64(circleId), circle.currentCycle, Status.Proposed, ref);
        emit ObligationProposed(circleId, id, msg.sender, payer, circle.currentCycle, amount, ref);

        Policy storage policy = _policies[circleId][payer][msg.sender];
        uint256 used = _autoUsed[circleId][circle.currentCycle][payer][msg.sender];
        if (amount <= policy.perObligationLimit && used + amount <= policy.perCycleLimit
            && _hasCoverage(circleId, payer, amount)) {
            _autoUsed[circleId][circle.currentCycle][payer][msg.sender] = used + amount;
            _accept(id, _obligations[id], circle, true);
        }
    }

    /// @notice Accept a current-cycle proposal as its payer, provided collateral covers it.
    function acceptObligation(uint256 id) external {
        Obligation storage obligation = _obligation(id);
        if (msg.sender != obligation.payer) revert NotPayer();
        _requireProposed(obligation);
        Circle storage circle = _circles[obligation.circleId];
        if (obligation.cycle != circle.currentCycle) revert StaleObligation();
        _requireUnpaused(circle);
        _requireNotOverdue(circle);
        // A departed payee must not acquire a net position outside the settlement loop.
        if (!_isMember[obligation.circleId][obligation.payer]
            || !_isMember[obligation.circleId][obligation.payee]) revert NotMember();
        if (!_hasCoverage(obligation.circleId, obligation.payer, obligation.amount)) revert InsufficientCoverage();
        _accept(id, obligation, circle, false);
    }

    /// @notice Reject a proposed invoice as its payer, including stale proposals while paused.
    function rejectObligation(uint256 id) external {
        Obligation storage obligation = _obligation(id);
        if (msg.sender != obligation.payer) revert NotPayer();
        _requireProposed(obligation);
        obligation.status = Status.Rejected;
        emit ObligationRejected(obligation.circleId, id, msg.sender);
    }

    /// @notice Cancel a proposed invoice as its payee, including stale proposals while paused.
    function cancelObligation(uint256 id) external {
        Obligation storage obligation = _obligation(id);
        if (msg.sender != obligation.payee) revert NotPayee();
        _requireProposed(obligation);
        obligation.status = Status.Cancelled;
        emit ObligationCancelled(obligation.circleId, id, msg.sender);
    }

    /// @notice Close one elapsed calendar cycle; anyone may call, even while paused.
    /// @dev At most MAX_MEMBERS iterations. Empty cycles skip the loop. Catch up by
    /// repeated calls; new cycle starts are calendar aligned, not reset to now.
    function closeCycle(uint256 circleId) external {
        Circle storage circle = _circle(circleId);
        uint256 end = uint256(circle.cycleStart) + circle.cycleDuration;
        if (block.timestamp < end) revert CycleNotEnded();
        if (end > type(uint64).max || circle.currentCycle == type(uint64).max) revert CapacityExceeded();
        uint64 cycle = circle.currentCycle;
        uint256 netVolume;
        if (circle.cycleObligationCount != 0) {
            address[] storage members = _members[circleId];
            uint256 length = members.length;
            for (uint256 i; i < length; ++i) {
                address member = members[i];
                int256 position = _net[circleId][member];
                if (position != 0) {
                    // Checked signed addition; coverage and totalBalances bound the result.
                    int256 settled = int256(_balance[circleId][member]) + position;
                    if (settled < 0) revert InsufficientCoverage();
                    _balance[circleId][member] = uint256(settled);
                    _net[circleId][member] = 0;
                    if (position > 0) netVolume += uint256(position);
                    emit NetSettled(circleId, cycle, member, position);
                }
            }
        }
        emit CycleClosed(circleId, cycle, circle.cycleGross, netVolume, circle.cycleObligationCount, uint64(end));
        circle.currentCycle = cycle + 1;
        circle.cycleStart = uint64(end);
        circle.cycleGross = 0;
        circle.cycleObligationCount = 0;
    }

    /// @notice Return an existing circle's administration and open-cycle state.
    function getCircle(uint256 id) external view returns (Circle memory) {
        return _circle(id);
    }

    /// @notice Return current members; array order can change when someone leaves.
    function getMembers(uint256 id) external view returns (address[] memory) {
        _circle(id);
        return _members[id];
    }

    /// @notice Return membership; unknown circles return false.
    function isMember(uint256 id, address member) external view returns (bool) {
        return _isMember[id][member];
    }

    /// @notice Return settled collateral; unknown circles or participants return zero.
    function balanceOf(uint256 id, address member) external view returns (uint256) {
        return _balance[id][member];
    }

    /// @notice Return the open-cycle net position: credits positive, debits negative.
    function netPositionOf(uint256 id, address member) external view returns (int256) {
        return _net[id][member];
    }

    /// @notice Return settled balance less net debits, clamped at zero; credits are not yet withdrawable.
    function withdrawableOf(uint256 id, address member) external view returns (uint256) {
        uint256 settled = _balance[id][member];
        int256 position = _net[id][member];
        if (position >= 0) return settled;
        int256 available = int256(settled) + position;
        return available > 0 ? uint256(available) : 0;
    }

    /// @notice Return an existing invoice, including its original cycle and stored status.
    function getObligation(uint256 id) external view returns (Obligation memory) {
        return _obligation(id);
    }

    /// @notice Whether an existing invoice is still Proposed but belongs to a closed cycle.
    function isExpired(uint256 obligationId) external view returns (bool) {
        Obligation storage obligation = _obligation(obligationId);
        return obligation.status == Status.Proposed && obligation.cycle < _circles[obligation.circleId].currentCycle;
    }

    /// @notice Return the current cycle's calendar end timestamp for an existing circle.
    function cycleEndsAt(uint256 circleId) external view returns (uint256) {
        Circle storage circle = _circle(circleId);
        return uint256(circle.cycleStart) + circle.cycleDuration;
    }

    /// @notice Return pairwise authorization limits; unset entries return zero limits.
    function policyOf(uint256 circleId, address payer, address payee) external view returns (Policy memory) {
        return _policies[circleId][payer][payee];
    }

    /// @notice Return automated invoice volume used by a payer/payee pair in a specific cycle.
    function autoUsedOf(uint256 circleId, uint64 cycle, address payer, address payee) external view returns (uint256) {
        return _autoUsed[circleId][cycle][payer][payee];
    }

    /// @notice Return outstanding invitation status; unknown circles return false.
    function isInvited(uint256 circleId, address member) external view returns (bool) {
        return _invited[circleId][member];
    }

    /// @dev Read an existing circle, using its nonzero administrator as the existence marker.
    function _circle(uint256 id) private view returns (Circle storage circle) {
        circle = _circles[id];
        if (circle.admin == address(0)) revert UnknownCircle();
    }

    /// @dev Read an existing obligation, using its status as the existence marker.
    function _obligation(uint256 id) private view returns (Obligation storage obligation) {
        obligation = _obligations[id];
        if (obligation.status == Status.None) revert UnknownObligation();
    }

    /// @dev Require that an invoice has not been accepted, rejected, or cancelled.
    function _requireProposed(Obligation storage obligation) private view {
        if (obligation.status != Status.Proposed) revert NotProposed();
    }

    /// @dev Gate only the three operations affected by selective pausing.
    function _requireUnpaused(Circle storage circle) private view {
        if (circle.paused) revert CircleIsPaused();
    }

    /// @dev Invoicing belongs to the calendar interval: once it elapses, closeCycle must run first.
    function _requireNotOverdue(Circle storage circle) private view {
        if (block.timestamp >= uint256(circle.cycleStart) + circle.cycleDuration) revert CycleOverdue();
    }

    /// @dev Compare available coverage before subtracting, avoiding signed underflow.
    function _hasCoverage(uint256 circleId, address payer, uint128 amount) private view returns (bool) {
        return int256(_balance[circleId][payer]) + _net[circleId][payer] >= int256(uint256(amount));
    }

    /// @dev Apply an already authorized, covered invoice. Paired net updates preserve zero sum.
    function _accept(uint256 id, Obligation storage obligation, Circle storage circle, bool automatic) private {
        uint256 gross = uint256(circle.cycleGross) + obligation.amount;
        if (gross > type(uint128).max || circle.cycleObligationCount == type(uint32).max) revert CapacityExceeded();
        int256 amount = int256(uint256(obligation.amount));
        _net[obligation.circleId][obligation.payer] -= amount;
        _net[obligation.circleId][obligation.payee] += amount;
        circle.cycleGross = uint128(gross);
        circle.cycleObligationCount += 1;
        obligation.status = Status.Accepted;
        emit ObligationAccepted(obligation.circleId, id, obligation.payer, automatic);
    }
}
